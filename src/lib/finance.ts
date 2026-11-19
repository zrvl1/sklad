import { db } from "./db";
import { cachedStatuses } from "./orders";
import { getSetting } from "./util";
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
      _sum: { amount: true, costAmount: true, profit: true },
      _count: true,
    }),
    db.receipt.aggregate({ where: { status: "posted", date: { gte: from, lt: to } }, _sum: { total: true }, _count: true }),
    db.expense.groupBy({ by: ["kind"], where: { date: { gte: from, lt: to } }, _sum: { amount: true } }),
  ]);
  const k = (kind: MoneyKind) => money.find((m) => m.kind === kind)?._sum.amount ?? 0;
  const revenue = orders._sum.amount ?? 0;
  const cogs = orders._sum.costAmount ?? 0;
  const gross = orders._sum.profit ?? revenue - cogs;
  const net = gross + k("income") - k("expense");
  const purchases = receipts._sum.total ?? 0;
  const cashIn = revenue + k("income") + k("invest");
  const cashOut = purchases + k("expense") + k("owner");
  return {
    sales: orders._count,
    revenue,
    cogs,
    gross,
    income: k("income"),
    expense: k("expense"),
    net,
    owner: k("owner"),
    invest: k("invest"),
    purchases,
    receipts: receipts._count,
    cashIn,
    cashOut,
    cashNet: cashIn - cashOut,
  };
}
