import { db } from "./db";

export function money(v: number | null | undefined) {
  return (v ?? 0).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function num(v: FormDataEntryValue | string | null | undefined, def = 0) {
  if (v === null || v === undefined) return def;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : def;
}

export function str(v: FormDataEntryValue | null | undefined) {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s === "" ? null : s;
}

export function dateInput(d: Date | null | undefined) {
  if (!d) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function dateUa(d: Date | null | undefined) {
  return d ? d.toLocaleDateString("uk-UA") : "";
}

export function dateTimeUa(d: Date | null | undefined) {
  return d ? d.toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }) : "";
}

/** Рядок для пошуку: нижній регістр, щоб працював і для кирилиці */
export function buildSearch(p: { name?: string | null; sku?: string | null; barcode?: string | null; sdId?: string | null }) {
  return [p.name, p.sku, p.barcode, p.sdId].filter(Boolean).join(" ").toLowerCase();
}

/** Ціна з урахуванням знижки, якщо знижка діє на вказану дату */
export function finalPrice(
  p: { price: number; discountValue: number | null; discountType: string | null; discountFrom: Date | null; discountTo: Date | null },
  at = new Date()
) {
  const v = p.discountValue ?? 0;
  if (v <= 0) return { price: p.price, old: null as number | null };
  const day = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  if (p.discountFrom && p.discountFrom > at) return { price: p.price, old: null };
  if (p.discountTo && new Date(p.discountTo.getFullYear(), p.discountTo.getMonth(), p.discountTo.getDate()) < day)
    return { price: p.price, old: null };
  const discounted = p.discountType === "amount" ? p.price - v : p.price * (1 - v / 100);
  return { price: Math.max(0, Math.round(discounted * 100) / 100), old: p.price };
}

export async function logAction(userId: number | null, action: string, entity: string, entityId?: string | number | null, details?: unknown) {
  await db.actionLog.create({
    data: {
      userId,
      action,
      entity,
      entityId: entityId === null || entityId === undefined ? null : String(entityId),
      details: details === undefined ? null : typeof details === "string" ? details : JSON.stringify(details),
    },
  });
}

export async function getSetting(key: string) {
  return (await db.setting.findUnique({ where: { key } }))?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
