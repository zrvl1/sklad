import { db } from "./db";
import { codeOwner } from "./codes";
import { internalEan13 } from "./barcode";
import { getSetting } from "./util";

/**
 * Наступний вільний артикул за шаблоном із «Штрихкоди й артикули» (напр. CM + 4 цифри → CM0471).
 * Рахується від найбільшого номера; картки-комплекти (CM0361-1) не враховуються. Після CM9999 буде CM10000.
 */
export async function nextSku() {
  const prefix = (await getSetting("skuPrefix")) ?? "ART";
  const digits = Number(await getSetting("skuDigits")) || 4;
  const rows = await db.product.findMany({ where: { sku: { startsWith: prefix } }, select: { sku: true } });
  let max = 0;
  for (const r of rows) {
    const tail = r.sku!.slice(prefix.length);
    if (!/^\d+$/.test(tail)) continue; // CM0361-1, CM0361A — не враховуємо
    const n = Number(tail);
    if (n > max) max = n;
  }
  for (let n = max + 1; ; n++) {
    const sku = prefix + String(n).padStart(digits, "0");
    if (!(await codeOwner(sku))) return sku;
  }
}

/** Вільний внутрішній штрихкод EAN-13 (200…) для нового товару, ще до його збереження */
export async function nextBarcode() {
  const last = await db.product.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
  for (let n = (last?.id ?? 0) + 1; ; n++) {
    const code = internalEan13(n);
    if (!(await codeOwner(code))) return code;
  }
}
