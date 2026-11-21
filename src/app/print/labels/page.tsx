import { ua } from "@/lib/names";
import { Suspense } from "react";
import type { Product } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getTemplate } from "@/lib/labels";
import { finalPrice, getSetting } from "@/lib/util";
import { getRates, toUah } from "@/lib/currency";
import Barcode from "@/components/Barcode";
import PrintToolbar from "@/components/PrintToolbar";

type SP = Promise<{
  items?: string; // "id:к-сть,id:к-сть"
  receipt?: string; // цінники на прихід
  one?: string; // по одному на товар
  stock?: string; // на весь залишок складу (кожна одиниця)
  all?: string; // по одному на кожен товар
  category?: string;
  tpl?: string;
  cell?: string; // показувати комірку на наліпці
  test?: string; // тестова наліпка для налаштування принтера
}>;

const MAX_LABELS = 2000;

const priceText = (v: number) => `${v.toLocaleString("uk-UA", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })} грн`;

export default async function PrintLabels({ searchParams }: { searchParams: SP }) {
  await requireUser();
  const sp = await searchParams;
  const t = getTemplate(sp.tpl);

  // Збираємо список: id товару → кількість етикеток
  const wanted = new Map<number, number>();
  if (sp.receipt) {
    const lines = await db.receiptLine.findMany({ where: { receiptId: Number(sp.receipt) } });
    for (const l of lines) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + (sp.one ? 1 : Math.max(1, Math.ceil(l.qty))));
    if (sp.one) for (const k of wanted.keys()) wanted.set(k, 1);
  }
  if (sp.stock || sp.all) {
    const wh = await db.warehouse.findFirst({ where: { isDefault: true } });
    const rows = await db.product.findMany({
      where: { deletedAt: null, baseProductId: null, ...(sp.category ? { categoryName: sp.category } : {}) },
      select: { id: true, stocks: { where: wh ? { warehouseId: wh.id } : {}, select: { qty: true } } },
      orderBy: { name: "asc" },
    });
    for (const r of rows) {
      const qty = Math.max(0, Math.ceil(r.stocks.reduce((s, x) => s + x.qty, 0)));
      if (sp.stock && qty > 0) wanted.set(r.id, qty);
      if (sp.all) wanted.set(r.id, 1);
    }
  }
  for (const part of (sp.items ?? "").split(",")) {
    const [id, q] = part.split(":").map(Number);
    if (id) wanted.set(id, (wanted.get(id) ?? 0) + Math.max(1, q || 1));
  }

  // картки-комплекти → наліпка основного товару (фізично на товарі одна наліпка)
  if (wanted.size) {
    const kits = await db.product.findMany({ where: { id: { in: [...wanted.keys()] }, baseProductId: { not: null } }, select: { id: true, baseProductId: true } });
    for (const k of kits) {
      const n = wanted.get(k.id) ?? 0;
      wanted.delete(k.id);
      wanted.set(k.baseProductId!, (wanted.get(k.baseProductId!) ?? 0) + n);
    }
  }
  const currency = process.env.ENABLE_CURRENCY === "true";
  const rates = currency ? await getRates() : { UAH: 1 };
  let products: Product[] = await db.product.findMany({ where: { id: { in: [...wanted.keys()] } } });
  if (sp.test) {
    // тестова наліпка: найдовша назва й типові дані, щоб перевірити переноси, штрихкод і поля
    products = [{ id: 0, name: "Тестовий товар із довгою назвою для перевірки переносу на два рядки", sku: "CM0471", barcode: "2000000004709", price: 1234.5 } as Product];
    wanted.set(0, 3);
  }
  // ціни у валюті — у гривні за курсом
  products = products.map((p) => ({ ...p, price: toUah(p.price, p.priceCurrency, rates) }));

  // Основна комірка товару (де лежить найбільше) — якщо обрано «комірка на наліпці»
  const cellOf = new Map<number, string>();
  if (sp.cell) {
    const pcs = await db.productCell.findMany({
      where: { productId: { in: products.map((p) => p.id) }, qty: { gt: 0 } },
      include: { cell: true },
      orderBy: { qty: "desc" },
    });
    for (const pc of pcs) if (!cellOf.has(pc.productId)) cellOf.set(pc.productId, pc.cell.code);
    if (sp.test) cellOf.set(0, "A-01-2");
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  const labels: { key: string; p: Product }[] = [];
  let truncated = false;
  for (const [id, q] of wanted) {
    const p = byId.get(id);
    if (!p) continue;
    for (let i = 0; i < q; i++) {
      if (labels.length >= MAX_LABELS) {
        truncated = true;
        break;
      }
      labels.push({ key: `${id}-${i}`, p });
    }
  }

  // зсув друку з сервера (однаковий для всіх браузерів/ярликів)
  const tplKey = (sp.tpl ?? "40x25").replace(/[^\w-]/g, "");
  let offset = { x: 0, y: 0 };
  try {
    const o = JSON.parse((await getSetting(`labelOffset:${tplKey}`)) ?? "{}");
    offset = { x: Number(o.x) || 0, y: Number(o.y) || 0 };
  } catch {}

  const pad = t.compact ? { t: 1, r: 1.5, b: 1, l: 3.5 } : { t: 1.5, r: 2, b: 1.5, l: 2 };
  // Великий зсув вправо (рулон стоїть не біля краю головки): сторінка ширша на X, наліпка з відступом зліва.
  // У драйвері принтера ширина паперу має бути така сама: t.w + X мм. Малий зсув — через внутрішні відступи.
  const bigX = !t.sheet && offset.x > pad.r ? offset.x : 0;
  const pageW = t.w + bigX;

  const pageCss = t.sheet
    ? `@page { size: A4; margin: 8mm 0 0 0; }
       .labels { display: grid; grid-template-columns: repeat(3, ${t.w}mm); grid-auto-rows: ${t.h}mm; justify-content: center; }
       .label { border: 0.2mm dashed #ccc; }
       @media print { .label { border-color: transparent; } }`
    : `@page { size: ${pageW}mm ${t.h}mm; margin: 0; }
       .labels { display: flex; flex-wrap: wrap; gap: 4mm; padding: 4mm; }
       .label { border: 0.2mm solid #ccc; }
       @media print {
         html, body { margin: 0 !important; padding: 0 !important; width: ${pageW}mm; }
         .label { margin-left: ${bigX}mm; }
         .labels { display: block; padding: 0; }
         .label { border: 0; page-break-after: always; break-after: page; }
         /* остання наліпка — без розриву сторінки, інакше принтер проганяє ще одну порожню */
         .label:last-child { page-break-after: auto; break-after: auto; }
       }`;

  return (
    <div style={{ background: "#fff", minHeight: "100vh" }}>
      <style>{`
        :root { --ox: ${offset.x}mm; --oy: ${offset.y}mm; }
        body { background: #fff; }
        ${pageCss}
        /* зсув = перерозподіл внутрішніх відступів: вміст не виходить за межі наліпки, тож Chrome не зменшує сторінку */
        .label { width: ${t.w}mm; height: ${t.h}mm; overflow: hidden; box-sizing: border-box;
                 padding-top: max(0mm, calc(${pad.t}mm + var(--oy, 0mm)));
                 padding-bottom: max(0mm, calc(${pad.b}mm - var(--oy, 0mm)));
                 padding-left: ${bigX ? `${pad.l}mm` : `max(0mm, calc(${pad.l}mm + var(--ox, 0mm)))`};
                 padding-right: ${bigX ? `${pad.r}mm` : `max(0mm, calc(${pad.r}mm - var(--ox, 0mm)))`};
                 display: flex; flex-direction: column; justify-content: space-between; font-family: Arial, sans-serif; color: #000; }
        @media print { html, body { overflow: hidden !important; } }
        @media print { body.print-frame .label { border: 0.2mm solid #000 !important; } }
        .label .name { font-size: ${t.nameSize}pt; line-height: 1.12; font-weight: 600;
                       display: -webkit-box; -webkit-line-clamp: ${t.compact ? 3 : 2}; -webkit-box-orient: vertical; overflow: hidden; }
        .label .prices { display: flex; align-items: baseline; justify-content: space-between; gap: 2mm; }
        .label .price { font-size: ${t.priceSize}pt; font-weight: 800; white-space: nowrap; }
        .label .old { font-size: ${Math.max(6, Math.round(t.priceSize * 0.5))}pt; text-decoration: line-through; color: #333; white-space: nowrap; }
        .label .meta { font-size: 6.5pt; color: #000; display: flex; justify-content: space-between; gap: 1mm; }
        .label .bottom { display: flex; align-items: flex-end; justify-content: space-between; gap: 1mm; line-height: 1; }
        .label .sku { font-size: 6.5pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .label .cell { font-size: 6.5pt; font-weight: 700; border: 0.2mm solid #000; padding: 0 0.6mm; margin-left: 1mm; }
        .label.compact .name { margin-bottom: 1.5mm; }
        .label .bc { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; }
        @media print { .no-print { display: none !important; } }
      `}</style>

      <Suspense>
        <PrintToolbar count={labels.length} truncated={truncated} offset={offset} pageW={bigX ? pageW : undefined} />
      </Suspense>

      {labels.length === 0 && <p style={{ padding: 20 }}>Немає товарів для друку.</p>}

      <div className="labels">
        {labels.map(({ key, p }) => {
          const fp = finalPrice(p);
          const cell = cellOf.get(p.id);
          if (t.compact) {
            // 40×25: назва (2 рядки) → штрихкод → артикул [комірка] … ціна
            return (
              <div className="label compact" key={key}>
                <div className="name">{ua(p)}</div>
                <div className="bc">{p.barcode ? <Barcode value={p.barcode} moduleMm={0.25} barMm={5} textMm={1.8} /> : null}</div>
                <div className="bottom">
                  <span className="sku">
                    {p.sku ?? ""}
                    {cell && <span className="cell">{cell}</span>}
                  </span>
                  <span style={{ textAlign: "right" }}>
                    {fp.old !== null && <span className="old">{priceText(fp.old)} </span>}
                    <span className="price">{priceText(fp.price)}</span>
                  </span>
                </div>
              </div>
            );
          }
          return (
            <div className="label" key={key}>
              <div className="name">{ua(p)}</div>
              <div className="prices">
                {fp.old !== null && <span className="old">{priceText(fp.old)}</span>}
                <span className="price">{priceText(fp.price)}</span>
              </div>
              {t.barcodeH > 0 && p.barcode ? (
                <Barcode value={p.barcode} moduleMm={t.w >= 50 ? 0.375 : 0.25} barMm={t.w >= 50 ? 12 : 9} textMm={t.w >= 50 ? 2.8 : 2.2} />
              ) : null}
              <div className="meta">
                <span>
                  {p.sku ?? ""}
                  {cell && <span className="cell">{cell}</span>}
                </span>
                <span>{t.barcodeH === 0 ? p.barcode ?? "" : ""}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
