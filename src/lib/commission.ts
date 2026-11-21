import { db } from "./db";
import { getSetting } from "./util";

export type PromCommission = { pct: number; catName: string | null };

/** Ставки комісії Prom по категоріях порталу: { "<catId>": 7.5 } — вписуються вручну з таблиці Prom */
export async function promRates(): Promise<Record<string, number>> {
  try {
    return JSON.parse((await getSetting("promCommissionRates")) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * Комісія Prom для товарів: категорія товару на Prom → ставка з таблиці Prom (Налаштування → Комісії Prom).
 * Товари, яких немає на Prom або для категорії яких ставку не вписано, — без комісії (не в Map).
 */
export async function promCommissions(productIds: number[]): Promise<{ byProduct: Map<number, PromCommission> }> {
  const byProduct = new Map<number, PromCommission>();
  if (!productIds.length) return { byProduct };
  const rates = await promRates();
  if (!Object.keys(rates).length) return { byProduct };
  const products = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sdId: true, sku: true, baseProductId: true } });
  // картки-комплекти — за основним товаром
  const baseIds = products.map((p) => p.baseProductId).filter((x): x is number => x !== null);
  const bases = baseIds.length ? await db.product.findMany({ where: { id: { in: baseIds } }, select: { id: true, sdId: true, sku: true } }) : [];
  const baseOf = new Map(bases.map((b) => [b.id, b]));
  const keyOf = (p: { sdId: string | null; sku: string | null }) => p;
  const all = products.map((p) => ({ id: p.id, ...keyOf(p.baseProductId ? (baseOf.get(p.baseProductId) ?? p) : p) }));
  const links = await db.promLink.findMany({
    where: {
      catId: { not: null },
      OR: [{ externalId: { in: all.map((p) => p.sdId).filter((x): x is string => !!x) } }, { sku: { in: all.map((p) => p.sku).filter((x): x is string => !!x) } }],
    },
    select: { externalId: true, sku: true, catId: true, catName: true },
  });
  const byExt = new Map(links.filter((l) => l.externalId).map((l) => [l.externalId!, l]));
  const bySku = new Map(links.filter((l) => l.sku).map((l) => [l.sku!, l]));
  for (const p of all) {
    const l = (p.sdId && byExt.get(p.sdId)) || (p.sku && bySku.get(p.sku)) || null;
    if (!l?.catId) continue;
    const pct = rates[l.catId];
    if (typeof pct === "number" && pct > 0) byProduct.set(p.id, { pct, catName: l.catName });
  }
  return { byProduct };
}
