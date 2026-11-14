/**
 * Шаблони цінників. Щоб додати свій розмір — додайте запис сюди.
 * Розміри в міліметрах. sheet = друк на аркуші A4 сіткою, інакше — один цінник на сторінку (термопринтер).
 */
export const LABEL_TEMPLATES = {
  "40x25": { title: "40×25 мм (термо, наліпка)", w: 40, h: 25, nameSize: 6.5, priceSize: 12, barcodeH: 22, sheet: false, compact: true },
  "58x40": { title: "58×40 мм (термо)", w: 58, h: 40, nameSize: 10, priceSize: 24, barcodeH: 32, sheet: false, compact: false },
  "58x30": { title: "58×30 мм (термо)", w: 58, h: 30, nameSize: 9, priceSize: 20, barcodeH: 22, sheet: false, compact: false },
  "40x30": { title: "40×30 мм (термо)", w: 40, h: 30, nameSize: 8, priceSize: 17, barcodeH: 22, sheet: false, compact: false },
  "30x20": { title: "30×20 мм (термо, без штрихкоду)", w: 30, h: 20, nameSize: 7, priceSize: 14, barcodeH: 0, sheet: false, compact: false },
  a4: { title: "A4, 3×8 (70×37 мм)", w: 70, h: 37, nameSize: 10, priceSize: 22, barcodeH: 28, sheet: true, compact: false },
} as const;

export type TemplateId = keyof typeof LABEL_TEMPLATES;

export function getTemplate(id: string | undefined) {
  return LABEL_TEMPLATES[(id && id in LABEL_TEMPLATES ? id : "40x25") as TemplateId];
}

/** Назви операцій у журналі руху товару */
export const MOVE_TYPES: Record<string, string> = {
  receipt: "Прихід",
  inventory: "Інвентаризація",
  "cell-move": "Переміщення",
  "cell-adjust": "Коригування комірки",
  "sale-auto": "Продаж (автосписання з комірки)",
  writeoff: "Списання",
};

export const WRITE_OFF_REASONS = ["Брак", "Втрата / нестача", "Пересорт", "Власні потреби", "Повернення постачальнику", "Подарунок / акція", "Інше"];
