import { ean13CheckDigit } from "./barcode";
import { codeOwner } from "./codes";

/** Перевірка штрихкоду: формат і контрольна цифра EAN-13 */
export function barcodeProblem(code: string | null | undefined): string | null {
  if (!code) return null;
  if (/\s/.test(code)) return "Штрихкод не може містити пробілів";
  if (code.length > 48) return "Задовгий штрихкод";
  if (/^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) !== code[12]) {
    return `Неправильна контрольна цифра EAN-13 (має бути ${ean13CheckDigit(code.slice(0, 12))}) — можливо, помилка при введенні`;
  }
  return null;
}

export function skuProblem(sku: string | null | undefined): string | null {
  if (!sku) return null;
  if (/^\s|\s$/.test(sku)) return "Артикул починається або закінчується пробілом";
  if (sku.length > 64) return "Задовгий артикул";
  return null;
}

/**
 * Повна перевірка кодів товару перед збереженням.
 * Повертає список помилок (блокують збереження) — дублікати й неправильний формат.
 */
export async function validateCodes(p: { id?: number | null; barcode?: string | null; sku?: string | null }) {
  const errors: string[] = [];
  const bp = barcodeProblem(p.barcode);
  if (bp) errors.push(bp);
  const sp = skuProblem(p.sku);
  if (sp) errors.push(sp);
  for (const [label, code] of [["Штрихкод", p.barcode], ["Артикул", p.sku]] as const) {
    if (!code) continue;
    const other = await codeOwner(code, p.id ?? undefined);
    if (other) errors.push(`${label} ${code} уже є в товару «${other.name}»`);
  }
  if (p.barcode && p.sku && p.barcode === p.sku) {
    // не помилка, але часто ознака того, що поля переплутали — допускаємо
  }
  return errors;
}

/** Числа з форми: не від'ємні, не NaN, без абсурдних значень */
export function moneyProblem(label: string, v: number) {
  if (!Number.isFinite(v)) return `${label}: не число`;
  if (v < 0) return `${label} не може бути від'ємною`;
  if (v > 10_000_000) return `${label}: надто велике значення`;
  return null;
}
