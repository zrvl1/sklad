import { db } from "./db";
import { cachedStatuses } from "./orders";
import { getSetting, setSetting } from "./util";
import type { MoneyKind } from "./finance-consts";
export * from "./finance-consts";

/** Які статуси заявок вважаються продажем (налаштовується у «Звіт: продажі»; за замовчуванням — «Продаж»/«Продано») */
export async function saleStatusFilter() {
  const [statuses, raw] = await Promise.all([cachedStatuses(), getSetting("saleStatuses")]);
  const saved: number[] = raw ? JSON.parse(raw) : [];
  const ids = saved.length ? saved : statuses.filter((s) => /прода[нж]/i.test(s.name)).map((s) => s.id);
  return ids.length ? { statusId: { in: ids } } : {};
}

/** Підсумки місяця: прибуток і рух грошей */
export async function monthSummary(from: Date, to: Date) {
  const statusFilter = await saleStatusFilter();
  const [orders, receipts, money] = await Promise.all([
    db.sdOrder.aggregate({
      where: { orderTime: { gte: from, lt: to }, ...statusFilter },
      _sum: { amount: true, costAmount: true, profit: true, commission: true },
      _count: true,
    }),
    db.receipt.findMany({
      where: { status: "posted", date: { gte: from, lt: to } },
      select: { total: true, paidEarlier: true, date: true, supplier: { select: { ledgerFrom: true } } },
    }),
    db.expense.groupBy({ by: ["kind"], where: { date: { gte: from, lt: to } }, _sum: { amount: true } }),
  ]);
  const k = (kind: MoneyKind) => money.find((m) => m.kind === kind)?._sum.amount ?? 0;
  const revenue = orders._sum.amount ?? 0;
  const cogs = orders._sum.costAmount ?? 0;
  const commission = orders._sum.commission ?? 0;
  // рахуємо самі: виручка − собівартість − комісія Prom (прибуток SalesDrive уже містить мінус комісію — не віднімати двічі)
  const gross = revenue - cogs - commission;
  const net = gross + k("income") - k("expense");
  // гроші за товар: приходи, оплачені при отриманні (без «оплачено раніше» і без боргу постачальнику),
  // плюс реальні оплати постачальникам з боргом (у гривнях, як купили валюту/віддали готівку)
  const onCredit = (r: (typeof receipts)[number]) => Boolean(r.supplier?.ledgerFrom && r.date >= r.supplier.ledgerFrom);
  const paidOnReceipt = receipts.filter((r) => !r.paidEarlier && !onCredit(r)).reduce((s, r) => s + r.total, 0);
  const supplierPaid = (await db.supplierPayment.aggregate({ where: { date: { gte: from, lt: to } }, _sum: { uah: true } }))._sum.uah ?? 0;
  const purchases = Math.round((paidOnReceipt + supplierPaid) * 100) / 100;
  const cashIn = revenue + k("income") + k("invest");
  const cashOut = purchases + commission + k("expense") + k("owner");
  return {
    sales: orders._count,
    revenue,
    cogs,
    commission,
    gross,
    income: k("income"),
    expense: k("expense"),
    net,
    owner: k("owner"),
    invest: k("invest"),
    purchases,
    receipts: receipts.length,
    receiptsCounted: receipts.filter((r) => !r.paidEarlier && !onCredit(r)).length,
    supplierPaid,
    cashIn,
    cashOut,
    cashNet: cashIn - cashOut,
  };
}

/** Вартість складу за собівартістю зараз (лише основні товари; картки-комплекти — це той самий товар) */
export async function stockValueNow() {
  const rows = await db.stockBalance.findMany({
    where: { qty: { gt: 0 }, product: { deletedAt: null, baseProductId: null } },
    select: { qty: true, product: { select: { cost: true } } },
  });
  let value = 0;
  let qty = 0;
  let noCost = 0;
  for (const r of rows) {
    qty += r.qty;
    if (r.product.cost > 0) value += r.qty * r.product.cost;
    else noCost += r.qty;
  }
  return { value: Math.round(value * 100) / 100, qty, noCost };
}

/**
 * Знімок вартості складу на 1-ше число місяця (зберігається один раз за місяць: денний крон і перший перегляд сторінки).
 * Кінець місяця = знімок на початок наступного.
 */
export async function ensureStockSnapshot(date = new Date()) {
  const key = `stockValue:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const have = await getSetting(key);
  if (have) return JSON.parse(have) as { at: string; value: number; qty: number; noCost: number };
  const v = { at: new Date().toISOString(), ...(await stockValueNow()) };
  await setSetting(key, JSON.stringify(v));
  return v;
}

export async function stockSnapshot(month: string) {
  const raw = await getSetting(`stockValue:${month}`);
  return raw ? (JSON.parse(raw) as { at: string; value: number; qty: number; noCost: number }) : null;
}
