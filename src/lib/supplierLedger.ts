/**
 * Розрахунки з постачальником у валюті.
 * Борг = проведені приходи (у валюті) − оплати. Кожен прихід потрапив у собівартість за курсом дня приходу,
 * тож за боргом «стоїть» певна сума гривень (середній курс боргу). Коли платите — порівнюємо, скільки гривень
 * реально витрачено на валюту/готівку, з тим, за скільки цей борг був у собівартості. Різниця — курсова різниця
 * (запис у «Гроші за місяць»: витрата, якщо валюта подорожчала, дохід — якщо подешевшала).
 */
import { db } from "./db";

export type Balance = {
  currency: string;
  receipts: number; // сума приходів у валюті
  receiptsUah: number; // у собівартості, грн
  paid: number; // оплачено у валюті
  paidBookedUah: number;
  paidUah: number; // реально витрачено гривень
  debt: number; // борг у валюті (мінус — переплата/аванс)
  debtUah: number; // борг за курсами приходів, грн
  avgRate: number | null; // середній курс боргу
  fxDiff: number; // накопичена курсова різниця (+ втрата, − виграш)
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function supplierBalance(supplierId: number, currency: string): Promise<Balance> {
  const [rec, pay] = await Promise.all([
    db.receipt.aggregate({ where: { supplierId, currency, status: "posted" }, _sum: { totalCurrency: true, total: true } }),
    db.supplierPayment.aggregate({ where: { supplierId, currency }, _sum: { amount: true, bookedUah: true, uah: true, diffUah: true } }),
  ]);
  const receipts = rec._sum.totalCurrency ?? 0;
  const receiptsUah = rec._sum.total ?? 0;
  const paid = pay._sum.amount ?? 0;
  const paidBookedUah = pay._sum.bookedUah ?? 0;
  const debt = r2(receipts - paid);
  const debtUah = r2(receiptsUah - paidBookedUah);
  return {
    currency,
    receipts: r2(receipts),
    receiptsUah: r2(receiptsUah),
    paid: r2(paid),
    paidBookedUah: r2(paidBookedUah),
    paidUah: r2(pay._sum.uah ?? 0),
    debt,
    debtUah,
    avgRate: debt > 0.005 && debtUah > 0 ? Math.round((debtUah / debt) * 10000) / 10000 : null,
    fxDiff: r2(pay._sum.diffUah ?? 0),
  };
}

/** Скільки гривень собівартості «гаситься» оплатою amount (за середнім курсом боргу; аванс понад борг — без різниці) */
export function bookedFor(b: Balance, amount: number, uah: number) {
  if (b.currency === "UAH") return amount;
  const coveredByDebt = Math.max(0, Math.min(amount, b.debt));
  const advance = amount - coveredByDebt;
  const rateSpent = amount > 0 ? uah / amount : 0;
  return r2(coveredByDebt * (b.avgRate ?? rateSpent) + advance * rateSpent);
}
