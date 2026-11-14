/** Контрольна цифра EAN-13 для 12 цифр */
export function ean13CheckDigit(base12: string) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

export function isValidEan13(code: string) {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === code[12];
}

/**
 * Внутрішній штрихкод магазину: префікс 200–299 зарезервований для внутрішнього використання,
 * тому не перетнеться з кодами виробників.
 */
export function internalEan13(productId: number) {
  const base = "200" + String(productId).padStart(9, "0");
  return base + ean13CheckDigit(base);
}

export function barcodeFormat(code: string): "EAN13" | "EAN8" | "CODE128" {
  if (isValidEan13(code)) return "EAN13";
  if (/^\d{8}$/.test(code)) return "EAN8";
  return "CODE128";
}
