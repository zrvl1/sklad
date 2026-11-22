import { db } from "./db";
import { getSetting } from "./util";

export type LabelCfg = { low: number; high: number; idField: "both" | "sdId" | "sku" };

export async function labelCfg(): Promise<LabelCfg> {
  try {
    const c = JSON.parse((await getSetting("merchantLabelCfg")) ?? "{}") as Partial<LabelCfg>;
    return { low: c.low ?? 100, high: c.high ?? 250, idField: c.idField === "sku" || c.idField === "sdId" ? c.idField : "both" };
  } catch {
    return { low: 100, high: 250, idField: "both" };
  }
}

export type LabelRow = { id: string; brand: string; margin: string; stock: string; price: string; marginUah: number | null; name: string };

/**
 * Мітки для Google Merchant Center (додаткове джерело даних): маржа в гривнях з одного продажу,
 * залишок і ціновий діапазон. Картки-комплекти — за залишком основного товару.
 */
export async function labelRows(): Promise<LabelRow[]> {
  const cfg = await labelCfg();
  const products = await db.product.findMany({
    where: { deletedAt: null },
    select: { id: true, sdId: true, sku: true, name: true, nameTranslate: true, manufacturer: true, price: true, cost: true, baseProductId: true, kitQty: true, stocks: { select: { qty: true } } },
  });
  const stockOf = new Map<number, number>(products.map((p) => [p.id, p.stocks.reduce((s, x) => s + Number(x.qty), 0)]));
  const out: LabelRow[] = [];
  for (const p of products) {
    // у Merchant ID товару буває і ID SalesDrive (3168664887, W000476), і SKU (CM0518-1) — даємо обидва, зайві Merchant пропустить
    const ids = [...new Set([cfg.idField !== "sku" ? p.sdId : null, cfg.idField !== "sdId" ? p.sku : null].filter((x): x is string => !!x))];
    if (!ids.length) continue;
    const st: number = p.baseProductId ? Math.floor((stockOf.get(p.baseProductId) ?? 0) / (p.kitQty || 1)) : (stockOf.get(p.id) ?? 0);
    const m = p.price > 0 && p.cost > 0 ? p.price - p.cost : null;
    for (const id of ids)
    out.push({
      id,
      name: p.nameTranslate || p.name,
      brand: p.manufacturer?.trim() ?? "",
      marginUah: m === null ? null : Math.round(m),
      margin: m === null ? "маржа-невідома" : m < cfg.low ? "маржа-низька" : m < cfg.high ? "маржа-середня" : "маржа-висока",
      stock: st <= 0 ? "залишок-0" : st === 1 ? "залишок-1" : st <= 3 ? "залишок-мало" : "залишок-багато",
      price: p.price < 300 ? "ціна-до-300" : p.price < 1000 ? "ціна-300-1000" : "ціна-від-1000",
    });
  }
  return out;
}
