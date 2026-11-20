import { db } from "./db";
import { getSetting } from "./util";
import { saleStatusFilter } from "./finance";

/** Продажі за N днів, зведені на основні (фізичні) товари: продажі карток-комплектів × кількість у картці */
export async function salesByBase(days: number) {
  const since = new Date(Date.now() - days * 86400_000);
  const statusFilter = await saleStatusFilter();
  const lines = await db.sdOrderLine.findMany({
    where: { productId: { not: null }, order: { orderTime: { gte: since }, ...statusFilter } },
    select: { productId: true, qty: true, price: true, costPrice: true, product: { select: { baseProductId: true, kitQty: true } } },
  });
  const out = new Map<number, { qty: number; revenue: number; profit: number }>();
  for (const l of lines) {
    const base = l.product?.baseProductId ?? l.productId!;
    const mult = l.product?.baseProductId ? l.product.kitQty || 1 : 1;
    const r = out.get(base) ?? { qty: 0, revenue: 0, profit: 0 };
    r.qty += l.qty * mult;
    r.revenue += l.qty * l.price;
    r.profit += l.qty * (l.price - l.costPrice);
    out.set(base, r);
  }
  return out;
}

/** Залишок основних товарів по всіх складах */
export async function stockByProduct() {
  const rows = await db.stockBalance.groupBy({ by: ["productId"], where: { product: { deletedAt: null, baseProductId: null } }, _sum: { qty: true } });
  return new Map<number, number>(rows.map((r) => [r.productId, r._sum.qty ?? 0]));
}

export async function reorderSettings() {
  const [lead, cover] = await Promise.all([getSetting("reorderLeadDays"), getSetting("reorderCoverDays")]);
  return { leadDays: Number(lead) || 14, coverDays: Number(cover) || 30 };
}

export type ReorderRow = {
  id: number;
  name: string;
  nameTranslate: string | null;
  sku: string | null;
  images: string | null;
  supplierName: string | null;
  cost: number;
  stock: number;
  sold30: number;
  sold90: number;
  minStock: number | null; // задано вручну
  suggestedMin: number; // підказка за продажами
  effectiveMin: number;
  toOrder: number;
  below: boolean;
};

/**
 * Мінімальний залишок і що дозамовити.
 * Підказка мінімуму = продажі за час поставки (за середнім темпом 90 днів), округлено вгору.
 * Дозамовити = запас на «час поставки + на скільки днів закуповуємо», але не менше ніж мінімум + 1, мінус залишок.
 */
export async function reorderRows() {
  const { leadDays, coverDays } = await reorderSettings();
  const [s30, s90, stock, products] = await Promise.all([
    salesByBase(30),
    salesByBase(90),
    stockByProduct(),
    db.product.findMany({
      where: { deletedAt: null, baseProductId: null },
      select: { id: true, name: true, nameTranslate: true, sku: true, images: true, supplierName: true, cost: true, minStock: true },
    }),
  ]);
  const rows: ReorderRow[] = products.map((p) => {
    const sold90 = s90.get(p.id)?.qty ?? 0;
    const sold30 = s30.get(p.id)?.qty ?? 0;
    // темп: беремо більший із 30- і 90-денного, щоб не проспати зростання
    const daily = Math.max(sold90 / 90, sold30 / 30);
    const suggestedMin = daily > 0 ? Math.max(1, Math.ceil(daily * leadDays)) : 0;
    const effectiveMin = p.minStock ?? suggestedMin;
    const st = stock.get(p.id) ?? 0;
    const target = Math.max(Math.ceil(daily * (leadDays + coverDays)), effectiveMin + 1);
    const below = effectiveMin > 0 && st <= effectiveMin;
    return {
      ...p,
      stock: st,
      sold30,
      sold90,
      suggestedMin,
      effectiveMin,
      toOrder: below ? Math.max(0, target - st) : 0,
      below,
    };
  });
  return { rows, leadDays, coverDays };
}

export type AbcRow = {
  id: number;
  name: string;
  nameTranslate: string | null;
  sku: string | null;
  images: string | null;
  qty: number;
  revenue: number;
  profit: number;
  share: number; // частка прибутку, %
  cum: number; // накопичена частка, %
  cls: "A" | "B" | "C";
  stock: number;
  stockValue: number;
};

/** ABC за валовим прибутком: A — перші 80% прибутку, B — до 95%, C — решта і без продажів */
export async function abcRows(days = 90) {
  const [sales, stock, products] = await Promise.all([
    salesByBase(days),
    stockByProduct(),
    db.product.findMany({
      where: { deletedAt: null, baseProductId: null },
      select: { id: true, name: true, nameTranslate: true, sku: true, images: true, cost: true },
    }),
  ]);
  const withSales = products
    .map((p) => {
      const s = sales.get(p.id);
      const st = stock.get(p.id) ?? 0;
      return { ...p, qty: s?.qty ?? 0, revenue: s?.revenue ?? 0, profit: Math.max(0, s?.profit ?? 0), stock: st, stockValue: st * p.cost };
    })
    .sort((a, b) => b.profit - a.profit || b.revenue - a.revenue);
  const total = withSales.reduce((s, x) => s + x.profit, 0) || 1;
  let cum = 0;
  const rows: AbcRow[] = withSales.map((x) => {
    const share = (x.profit / total) * 100;
    const before = cum;
    cum += share;
    const cls: AbcRow["cls"] = x.profit <= 0 ? "C" : before < 80 ? "A" : before < 95 ? "B" : "C";
    return { id: x.id, name: x.name, nameTranslate: x.nameTranslate, sku: x.sku, images: x.images, qty: x.qty, revenue: x.revenue, profit: x.profit, share, cum, cls, stock: x.stock, stockValue: x.stockValue };
  });
  return rows;
}
