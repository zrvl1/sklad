import { Suspense } from "react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getTemplate } from "@/lib/labels";
import { finalPrice } from "@/lib/util";
import Barcode from "@/components/Barcode";
import PrintToolbar from "@/components/PrintToolbar";

type SP = Promise<{ items?: string; receipt?: string; tpl?: string; one?: string }>;

const MAX_LABELS = 2000;

const priceText = (v: number) =>
  `${v.toLocaleString("uk-UA", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })} ₴`;

export default async function PrintLabels({ searchParams }: { searchParams: SP }) {
  await requireUser();
  const sp = await searchParams;
  const t = getTemplate(sp.tpl);

  // Збираємо список: id товару → кількість цінників
  const wanted = new Map<number, number>();
  if (sp.receipt) {
    const lines = await db.receiptLine.findMany({ where: { receiptId: Number(sp.receipt) } });
    for (const l of lines) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + (sp.one ? 1 : Math.max(1, Math.ceil(l.qty))));
    if (sp.one) for (const k of wanted.keys()) wanted.set(k, 1);
  }
  for (const part of (sp.items ?? "").split(",")) {
    const [id, q] = part.split(":").map(Number);
    if (id) wanted.set(id, (wanted.get(id) ?? 0) + Math.max(1, q || 1));
  }

  const products = await db.product.findMany({ where: { id: { in: [...wanted.keys()] } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const labels: { key: string; p: (typeof products)[number] }[] = [];
  for (const [id, q] of wanted) {
    const p = byId.get(id);
    if (!p) continue;
    for (let i = 0; i < q && labels.length < MAX_LABELS; i++) labels.push({ key: `${id}-${i}`, p });
  }

  const pageCss = t.sheet
    ? `@page { size: A4; margin: 8mm 0 0 0; }
       .labels { display: grid; grid-template-columns: repeat(3, ${t.w}mm); grid-auto-rows: ${t.h}mm; justify-content: center; }
       .label { border: 0.2mm dashed #ccc; }
       @media print { .label { border-color: transparent; } }`
    : `@page { size: ${t.w}mm ${t.h}mm; margin: 0; }
       .labels { display: flex; flex-wrap: wrap; gap: 4mm; padding: 4mm; }
       .label { border: 0.2mm solid #ccc; }
       @media print { .labels { display: block; padding: 0; } .label { border: 0; page-break-after: always; break-after: page; } }`;

  return (
    <div style={{ background: "#fff", minHeight: "100vh" }}>
      <style>{`
        body { background: #fff; }
        ${pageCss}
        .label { width: ${t.w}mm; height: ${t.h}mm; padding: 1.5mm 2mm; overflow: hidden;
                 display: flex; flex-direction: column; justify-content: space-between; font-family: Arial, sans-serif; color: #000; }
        .label .name { font-size: ${t.nameSize}pt; line-height: 1.15; font-weight: 600;
                       display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .label .prices { display: flex; align-items: baseline; justify-content: space-between; gap: 2mm; }
        .label .price { font-size: ${t.priceSize}pt; font-weight: 800; white-space: nowrap; }
        .label .old { font-size: ${Math.round(t.priceSize * 0.5)}pt; text-decoration: line-through; color: #444; white-space: nowrap; }
        .label .meta { font-size: 6.5pt; color: #222; display: flex; justify-content: space-between; }
        @media print { .no-print { display: none !important; } }
      `}</style>

      <Suspense>
        <PrintToolbar count={labels.length} />
      </Suspense>

      {labels.length === 0 && <p style={{ padding: 20 }}>Немає товарів для друку.</p>}

      <div className="labels">
        {labels.map(({ key, p }) => {
          const fp = finalPrice(p);
          return (
            <div className="label" key={key}>
              <div className="name">{p.name}</div>
              <div className="prices">
                {fp.old !== null && <span className="old">{priceText(fp.old)}</span>}
                <span className="price">{priceText(fp.price)}</span>
              </div>
              {t.barcodeH > 0 && p.barcode ? (
                <Barcode value={p.barcode} height={t.barcodeH} fontSize={t.w >= 50 ? 11 : 9} width={t.w >= 50 ? 1.6 : 1.2} />
              ) : null}
              <div className="meta">
                <span>{p.sku ?? ""}</span>
                <span>{t.barcodeH === 0 ? p.barcode ?? "" : ""}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
