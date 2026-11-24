import { db } from "./db";
import { getSetting } from "./util";

/** Курси, які власник вводить сам у додатку (щодня) — їх не перезаписуємо курсами SalesDrive */
export type ManualRates = Record<string, { rate: number; at: string }>;
export async function manualRates(): Promise<ManualRates> {
  try {
    return JSON.parse((await getSetting("manualRates")) ?? "{}") as ManualRates;
  } catch {
    return {};
  }
}

export const BASE = "UAH";

/**
 * Оновити курси валют із SalesDrive (GET /api/currencies/).
 * Для цього API-ключу потрібне право «Курси валют: читання».
 */
export async function refreshRates() {
  const url = process.env.SALESDRIVE_URL?.replace(/\/+$/, "");
  const key = process.env.SALESDRIVE_FORM_KEY;
  if (!url || !key) throw new Error("SalesDrive не налаштовано");
  const res = await fetch(`${url}/api/currencies/`, { headers: { "X-Api-Key": key }, cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`Курси валют: SalesDrive відповів ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as { baseCurrency?: string; currencies?: { code: string; rate: number | string }[] };
  const list = (data.currencies ?? []).map((c) => ({ code: String(c.code).toUpperCase(), rate: Number(c.rate) })).filter((c) => c.code && c.rate > 0);
  const manual = await manualRates();
  for (const c of list) if (!manual[c.code]) await db.currency.upsert({ where: { code: c.code }, update: { rate: c.rate }, create: c });
  return { base: data.baseCurrency ?? BASE, list };
}

/** Курси з кешу; якщо застаріли (більше години) — оновлюємо з SalesDrive */
export async function getRates(): Promise<Record<string, number>> {
  let rows = await db.currency.findMany();
  const manual = await manualRates().catch(() => ({}) as ManualRates);
  const auto = rows.filter((r) => !manual[r.code]);
  const stale = !rows.length || auto.some((r) => Date.now() - r.updatedAt.getTime() > 60 * 60 * 1000);
  if (stale) {
    try {
      await refreshRates();
      rows = await db.currency.findMany();
    } catch {
      /* немає зв'язку — працюємо з тим, що є в кеші */
    }
  }
  const out: Record<string, number> = { [BASE]: 1 };
  for (const r of rows) out[r.code] = r.rate;
  out[BASE] = 1;
  return out;
}

export function toUah(amount: number, currency: string | null | undefined, rates: Record<string, number>) {
  if (!currency || currency === BASE) return amount;
  const r = rates[currency];
  return r ? Math.round(amount * r * 100) / 100 : amount;
}
