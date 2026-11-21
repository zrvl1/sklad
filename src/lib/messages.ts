/**
 * Шаблони повідомлень клієнтам (Viber / Telegram / SMS) із підстановкою даних заявки SalesDrive.
 * Дані клієнта беруться з SalesDrive в момент показу і ніде не зберігаються.
 */
import { getSetting } from "./util";

export type MsgTemplate = { key: string; title: string; text: string };

export const DEFAULT_TEMPLATES: MsgTemplate[] = [
  {
    key: "acceptedPaid",
    title: "1. Прийнято — оплачено онлайн",
    text: `Crane-Moto | Замовлення №{номер} прийнято ✅

Добрий день, {ім'я}! Дякуємо за замовлення та оплату.

{товари}
Сума: {сума} грн
Доставка: {доставка}
Отримувач: {піб}, {телефон}

🚚 Відправляємо двічі на день — до 12:00 і до 17:00. ТТН надішлемо окремим повідомленням.
⚠️ Під час повітряної тривоги відділення Нової пошти зачиняються, тому відправка може перенестися на наступний день до 12:00.

Помітили помилку в даних? Напишіть у відповідь. Питання: {ТЕЛ} (Пн-Пт 10-17, Сб-Нд 10-16)`,
  },
  {
    key: "acceptedCod",
    title: "2. Прийнято — накладений платіж (підтвердіть)",
    text: `Crane-Moto | Замовлення №{номер}

Добрий день, {ім'я}! Дякуємо за замовлення.

{товари}
Сума: {сума} грн — оплата при отриманні
Доставка: {доставка}
Отримувач: {піб}, {телефон}

Будь ласка, підтвердіть замовлення відповіддю «Так» — і ми відправимо його найближчим рейсом (до 12:00 або до 17:00).
⚠️ Під час повітряної тривоги відділення Нової пошти зачиняються, тому відправка може перенестися на наступний день до 12:00.

Питання: {ТЕЛ} (Пн-Пт 10-17, Сб-Нд 10-16)`,
  },
  {
    key: "payRequest",
    title: "3. Очікуємо оплату (передоплата)",
    text: `Crane-Moto | Замовлення №{номер}

{ім'я}, до сплати {сума} грн.
Оплатити: {ОПЛАТА}

Після оплати відправимо найближчим рейсом (до 12:00 або до 17:00) і надішлемо ТТН.
Питання: {ТЕЛ}`,
  },
  {
    key: "paid",
    title: "4. Оплату отримано",
    text: `Crane-Moto | Оплату за замовлення №{номер} отримано, дякуємо! 🙌
Відправимо найближчим рейсом (до 12:00 або до 17:00), ТТН надішлемо окремим повідомленням.`,
  },
  {
    key: "shipped",
    title: "5. Відправлено",
    text: `Crane-Moto | Замовлення №{номер} відправлено 📦

ТТН: {ттн}
{до_сплати}Відстежити: https://novaposhta.ua/tracking/{ттн}

Питання щодо доставки — {ТЕЛ} (Пн-Пт 10-17, Сб-Нд 10-16).`,
  },
  {
    key: "delay",
    title: "6. Відправка переноситься (тривога)",
    text: `Crane-Moto | Замовлення №{номер}

{ім'я}, через повітряну тривогу відділення Нової пошти сьогодні зачинене, тому відправка переноситься на завтра до 12:00. Вибачте за незручності!
ТТН надішлемо одразу після відправки.`,
  },
  {
    key: "noStock",
    title: "7. Немає в наявності — аналог або повернення",
    text: `Crane-Moto | Замовлення №{номер}

Добрий день, {ім'я}! На жаль, [товар] зараз немає в наявності.
Можемо запропонувати [аналог] за [ціна] грн — він підходить на ваш мотоцикл.
Або скасуємо цю позицію [і повернемо кошти — якщо було оплачено].

Як вам зручніше? Напишіть у відповідь або зателефонуйте: {ТЕЛ}`,
  },
  {
    key: "fitCheck",
    title: "8. Уточнити модель мотоцикла (сумісність)",
    text: `Crane-Moto | Замовлення №{номер}

{ім'я}, щоб запчастина точно підійшла, напишіть, будь ласка, модель і рік вашого мотоцикла (або надішліть фото старої деталі / техпаспорта).
Перевіримо сумісність і одразу відправимо.`,
  },
  {
    key: "nocall",
    title: "9. Не додзвонилися",
    text: `Crane-Moto | Не змогли до вас додзвонитися щодо замовлення №{номер}.
Будь ласка, передзвоніть або напишіть у відповідь: {ТЕЛ} (Пн-Пт 10-17, Сб-Нд 10-16)`,
  },
  {
    key: "waiting",
    title: "10. Не забирає посилку",
    text: `Crane-Moto | Посилка №{номер} чекає на вас у відділенні 📬
ТТН: {ттн}
Будь ласка, заберіть її, поки діє безкоштовне зберігання. Якщо є питання — {ТЕЛ}`,
  },
  {
    key: "received",
    title: "11. Отримано — дякуємо + відгук",
    text: `Crane-Moto | Дякуємо за покупку! 🙌

Якщо є питання щодо товару, сумісності, встановлення або потрібне повернення — напишіть або зателефонуйте нам, і ми швидко все вирішимо:
📞 {ТЕЛ} · Viber: {VIBER} · Telegram: {TG}

Будемо дуже вдячні за відгук — це допомагає нам рости:
⭐ {відгук}
Каталог запчастин: {САЙТ}`,
  },
  {
    key: "returnInfo",
    title: "12. Повернення / обмін — як оформити",
    text: `Crane-Moto | Повернення за замовленням №{номер}

{ім'я}, повернути або обміняти товар можна протягом 14 днів, якщо він не був у використанні та збережено вигляд і упаковку.
1. Надішліть Новою поштою на: [ПІБ, телефон, місто, відділення].
2. Напишіть нам ТТН повернення.
Доставку повернення оплачує покупець, крім випадків браку — тоді доставку беремо на себе.
Кошти повертаємо після отримання й перевірки товару.
Питання: {ТЕЛ}`,
  },
  {
    key: "cancelled",
    title: "13. Замовлення скасовано",
    text: `Crane-Moto | Замовлення №{номер} скасовано.
Якщо це помилка або хочете оформити знову — напишіть у відповідь чи зателефонуйте: {ТЕЛ}`,
  },
];

export const SHOP_FIELDS = [
  { key: "ТЕЛ", label: "Телефон магазину", ph: "+380 XX XXX XX XX" },
  { key: "VIBER", label: "Viber (посилання або номер)", ph: "https://viber.click/380XXXXXXXXX" },
  { key: "TG", label: "Telegram (посилання)", ph: "https://t.me/cranemoto" },
  { key: "ВІДГУК_GOOGLE", label: "Посилання на відгук Google", ph: "https://g.page/r/…/review" },
  { key: "ВІДГУК_PROM", label: "Посилання на відгуки Prom", ph: "https://prom.ua/c…-crane-moto.html#reviews" },
  { key: "САЙТ", label: "Сайт", ph: "https://crane-moto.com" },
  { key: "ОПЛАТА", label: "Оплата: посилання monobank / Plata або реквізити", ph: "https://send.monobank.ua/jar/…" },
] as const;

export async function loadTemplates(): Promise<MsgTemplate[]> {
  try {
    const saved = JSON.parse((await getSetting("msgTemplates")) ?? "{}") as Record<string, string>;
    return DEFAULT_TEMPLATES.map((t) => ({ ...t, text: saved[t.key]?.trim() ? saved[t.key] : t.text }));
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

export async function loadShop(): Promise<Record<string, string>> {
  try {
    return JSON.parse((await getSetting("msgShop")) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

// ---------- розбір заявки SalesDrive (назви полів залежать від налаштувань — шукаємо гнучко) ----------
const str = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return str(o.text ?? o.name ?? o.title ?? o.value ?? "");
  }
  const s = String(v).trim();
  return s === "null" ? "" : s;
};
const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const money = (v: number) => v.toLocaleString("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export type OrderInfo = {
  id: number;
  time: string;
  statusId: number;
  name: string;
  firstName: string;
  phone: string;
  items: string;
  total: number;
  payment: string;
  delivery: string;
  ttn: string;
  cod: number;
  site: string;
};

export function parseOrder(o: Record<string, unknown>): OrderInfo {
  const c = (o.primaryContact ?? (Array.isArray(o.contacts) ? o.contacts[0] : null) ?? {}) as Record<string, unknown>;
  const firstName = str(c.fName);
  const name = [str(c.lName), firstName, str(c.mName)].filter(Boolean).join(" ");
  const phone = str(Array.isArray(c.phone) ? c.phone[0] : c.phone).replace(/[^\d+]/g, "");
  const products = (o.products ?? []) as Record<string, unknown>[];
  const items = products
    .map((p) => `• ${str(p.text ?? p.name)} × ${num(p.amount) || 1} — ${money(num(p.price) * (num(p.amount) || 1) - num(p.discount))} грн`)
    .join("\n");
  const total = num(o.paymentAmount) || products.reduce((s, p) => s + num(p.price) * (num(p.amount) || 1) - num(p.discount), 0);
  const dd = ((o.ord_delivery_data ?? []) as Record<string, unknown>[])[0] ?? {};
  const city = str(dd.cityName ?? dd.city);
  const branch = str(dd.branchNumber) ? `відділення №${str(dd.branchNumber)}` : "";
  const addr = str(dd.address ?? o.shipping_address);
  const delivery = ["Нова пошта", city, branch || addr].filter(Boolean).join(", ");
  const ttn = str(dd.trackingNumber);
  const cod = num(dd.cashOnDeliveryAmount ?? dd.cod ?? dd.backwardDeliveryAmount);
  const keys = Object.keys(o);
  const site = str(o.sajt ?? keys.filter((k) => /^(sait|site|shop|sayt)$/i.test(k)).map((k) => o[k])[0]);
  return { id: Number(o.id), time: str(o.orderTime), statusId: Number(o.statusId) || 0, name, firstName, phone, items, total, payment: str(o.payment_method ?? o.paymentMethod), delivery, ttn, cod, site };
}

/** Підставити дані заявки й контакти магазину в шаблон */
export function fill(text: string, o: OrderInfo, shop: Record<string, string>) {
  const isProm = /prom/i.test(o.site);
  const vars: Record<string, string> = {
    номер: String(o.id),
    "ім'я": o.firstName || "",
    піб: o.name,
    телефон: o.phone,
    товари: o.items,
    сума: money(o.total),
    оплата: o.payment || "—",
    доставка: o.delivery,
    ттн: o.ttn || "(ще немає ТТН)",
    до_сплати: o.cod > 0 ? `До сплати при отриманні: ${money(o.cod)} грн\n` : "",
    відгук: (isProm ? shop["ВІДГУК_PROM"] : shop["ВІДГУК_GOOGLE"]) || shop["ВІДГУК_GOOGLE"] || shop["ВІДГУК_PROM"] || "",
    ...shop,
  };
  return text
    .replace(/\{([^{}\n]+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
    .replace(/Добрий день, !/g, "Добрий день!")
    .replace(/\n{3,}/g, "\n\n");
}

/** Статуси SalesDrive, заявки в яких показуються в списку (за замовчуванням — «Прийнято…») */
export async function listStatusIds(all: { id: number; name: string }[]): Promise<number[]> {
  try {
    const saved = JSON.parse((await getSetting("msgStatusIds")) ?? "[]") as number[];
    if (saved.length) return saved;
  } catch {}
  return all.filter((s) => /прийнят|принят/i.test(s.name)).map((s) => s.id).slice(0, 1);
}

/** Який шаблон підтвердження пропонувати: оплачено онлайн чи накладений платіж */
export function suggestTemplate(o: OrderInfo): string {
  if (o.cod > 0 || /наклад|післяплат|при отрим|cash|cod/i.test(o.payment)) return "acceptedCod";
  if (/оплачен|monobank|plata|карт|онлайн|liqpay|передоплат/i.test(o.payment)) return "acceptedPaid";
  return "acceptedCod";
}
