import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { mainImage } from "@/lib/images";
import { ua } from "@/lib/names";
import { promCommissions } from "@/lib/commission";
import { searchWords } from "@/lib/util";
import RepricingTable from "./RepricingTable";

type SP = Promise<{ q?: string; cat?: string; low?: string; prom?: string; page?: string }>;
const PAGE = 100;

export default async function RepricingPage({ searchParams }: { searchParams: SP }) {
  await requirePerm("costs");
  await requirePerm("products.edit");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const low = Number(sp.low) || 0; // показати лише з маржею нижче X%
  const [products, cats] = await Promise.all([
    db.product.findMany({
      where: { deletedAt: null, baseProductId: null, ...(q ? searchWords(q) : {}), ...(sp.cat ? { categoryName: sp.cat } : {}) },
      select: { id: true, name: true, nameTranslate: true, sku: true, images: true, price: true, cost: true, categoryName: true, stocks: { select: { qty: true } } },
      orderBy: { name: "asc" },
    }),
    db.product.findMany({ where: { deletedAt: null, categoryName: { not: null } }, distinct: ["categoryName"], select: { categoryName: true }, orderBy: { categoryName: "asc" } }),
  ]);
  const prom = (await promCommissions(products.map((p) => p.id))).byProduct;
  let rows = products.map((p) => {
    const pct = prom.get(p.id)?.pct ?? null;
    const m = p.price > 0 && p.cost > 0 ? ((p.price - p.cost) / p.price) * 100 : null;
    const mp = m !== null && pct ? ((p.price - p.cost - (p.price * pct) / 100) / p.price) * 100 : m;
    return {
      id: p.id,
      name: ua(p),
      sku: p.sku,
      image: mainImage(p.images),
      category: p.categoryName,
      stock: p.stocks.reduce((s, x) => s + x.qty, 0),
      price: p.price,
      cost: p.cost,
      promPct: pct,
      worst: mp, // гірша з двох маржа (з Prom, якщо є)
    };
  });
  if (sp.prom) rows = rows.filter((r) => r.promPct);
  if (low) rows = rows.filter((r) => r.worst !== null && r.worst < low);
  if (low) rows.sort((a, b) => (a.worst ?? 0) - (b.worst ?? 0));
  const page = Math.max(1, Number(sp.page) || 1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const qs = (p: number) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (sp.cat) s.set("cat", sp.cat);
    if (low) s.set("low", String(low));
    if (sp.prom) s.set("prom", "1");
    s.set("page", String(p));
    return `?${s}`;
  };

  return (
    <>
      <h1>Переоцінка</h1>
      <p className="muted small">
        Маржа = (ціна − собівартість) / ціна. «Prom» — якщо продати через Prom, з комісією за категорією (
        <Link href="/settings/prom-commission">ставки</Link>). Впишіть нову ціну — маржа перерахується одразу; «Зберегти» передасть ціни в SalesDrive, а
        звідти — на сайт і Prom.
      </p>
      <form className="panel toolbar" style={{ flexWrap: "wrap" }}>
        <input name="q" defaultValue={q} placeholder="Назва, SKU…" style={{ minWidth: 220 }} />
        <select name="cat" defaultValue={sp.cat ?? ""}>
          <option value="">Усі категорії</option>
          {cats.map((c) => (
            <option key={c.categoryName} value={c.categoryName!}>
              {c.categoryName}
            </option>
          ))}
        </select>
        <select name="low" defaultValue={sp.low ?? ""}>
          <option value="">Будь-яка маржа</option>
          <option value="15">Маржа нижче 15%</option>
          <option value="25">Маржа нижче 25%</option>
          <option value="35">Маржа нижче 35%</option>
        </select>
        <label className="small" style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" name="prom" value="1" defaultChecked={!!sp.prom} /> лише з комісією Prom
        </label>
        <button className="btn">Показати</button>
        <span className="small muted">знайдено: {rows.length}</span>
      </form>
      <RepricingTable key={qs(page)} rows={shown} />
      {pages > 1 && (
        <div className="toolbar">
          {page > 1 && (
            <Link className="btn sm" href={qs(page - 1)}>
              ← Назад
            </Link>
          )}
          <span className="small">
            Сторінка {page} з {pages}
          </span>
          {page < pages && (
            <Link className="btn sm" href={qs(page + 1)}>
              Далі →
            </Link>
          )}
        </div>
      )}
    </>
  );
}
