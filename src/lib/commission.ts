import { db } from "./db";

export type PromCommission = { pct: number; orders: number; own: boolean };

/**
 * Комісія Prom по товарах — з реальних заявок SalesDrive за рік.
 * Комісія заявки ділиться між товарами пропорційно сумі рядка; % = комісія / виручка товару на Prom.
 * Заявки Prom без комісії (напр. повторні клієнти) теж рахуються — це справжній середній відсоток.
 * Для товарів без продажів на Prom повертаємо середній % по всьому Prom (own = false).
 */
export async function promCommissions(productIds?: number[]): Promise<{ byProduct: Map<number, PromCommission>; avg: PromCommission | null }> {
  const since = new Date(Date.now() - 365 * 864e5);
  const orders = await db.sdOrder.findMany({
    where: { orderTime: { gte: since }, OR: [{ commission: { gt: 0 } }, { site: { contains: "prom", mode: "insensitive" } }] },
    select: { commission: true, lines: { select: { productId: true, qty: true, price: true } } },
  });
  // картки-комплекти рахуємо на основний товар
  const lineIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.productId)).filter((x): x is number => x !== null))];
  const kits = await db.product.findMany({ where: { id: { in: lineIds }, baseProductId: { not: null } }, select: { id: true, baseProductId: true } });
  const toBase = new Map(kits.map((k) => [k.id, k.baseProductId!]));

  const rev = new Map<number, number>();
  const com = new Map<number, number>();
  const cnt = new Map<number, number>();
  let totalRev = 0;
  let totalCom = 0;
  for (const o of orders) {
    const sum = o.lines.reduce((s, l) => s + l.qty * l.price, 0);
    if (!(sum > 0)) continue;
    totalRev += sum;
    totalCom += o.commission;
    const seen = new Set<number>();
    for (const l of o.lines) {
      if (l.productId === null) continue;
      const id = toBase.get(l.productId) ?? l.productId;
      const r = l.qty * l.price;
      rev.set(id, (rev.get(id) ?? 0) + r);
      com.set(id, (com.get(id) ?? 0) + (o.commission * r) / sum);
      if (!seen.has(id)) cnt.set(id, (cnt.get(id) ?? 0) + 1);
      seen.add(id);
    }
  }
  const avg = totalRev > 0 ? { pct: (totalCom / totalRev) * 100, orders: orders.length, own: false } : null;
  const byProduct = new Map<number, PromCommission>();
  for (const [id, r] of rev) {
    if (productIds && !productIds.includes(id)) continue;
    if (r > 0) byProduct.set(id, { pct: ((com.get(id) ?? 0) / r) * 100, orders: cnt.get(id) ?? 0, own: true });
  }
  if (productIds && avg) for (const id of productIds) if (!byProduct.has(id)) byProduct.set(id, avg);
  return { byProduct, avg };
}
