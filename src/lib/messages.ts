/**
 * Шаблони повідомлень клієнтам (Viber / Telegram / SMS) із підстановкою даних заявки SalesDrive.
 * Дані клієнта беруться з SalesDrive в момент показу і ніде не зберігаються.
 */
import { getSetting } from "./util";

export type MsgTemplate = { key: string; title: string; text: string };

export const DEFAULT_TEMPLATES: MsgTemplate[] = [
  {
    key: "accepted",
    title: "1. Замовлення прийнято",
    text: `Crane-Moto | Замовлення №{номер} прийнято ✅

Добрий день, {ім'я}! Дякуємо за замовлення.

Товари:
{товари}
Сума: {сума} грн
Оплата: {оплата}
Доставка: {доставка}
Отримувач: {піб}, {телефон}

🚚 Відправляємо двічі на день — до 12:00 і до 17:00. ТТН надішлемо окремим повідомленням.
⚠️ Під час повітряної тривоги відділення Нової пошти зачиняються, тому відправка може перенестися на наступний день до 12:00.

Помітили помилку в замовленні або є питання? Напишіть у відповідь на це повідомлення чи зателефонуйте: {ТЕЛ}
Працюємо: Пн–Пт 10–17, Сб–Нд 10–16`,
  },
  {
    key: "shipped",
    title: "2. Відправлено",
    text: `Crane-Moto | Замовлення №{номер} відправлено 📦

ТТН: {ттн}
{до_сплати}Відстежити: https://novaposhta.ua/tracking/{ттн}

Питання щодо доставки — {ТЕЛ} або Viber/Telegram.`,
  },
  {
    key: "received",
    title: "3. Отримано — дякуємо + відгук",
    text: `Crane-Moto | Дякуємо за покупку! 🙌

Якщо є питання щодо товару, сумісності, встановлення або потрібне повернення — напишіть або зателефонуйте нам, і ми швидко все вирішимо:
📞 {ТЕЛ} · Viber: {VIBER} · Telegram: {TG}

Будемо дуже вдячні за відгук — це допомагає нам рости:
⭐ {відгук}
Каталог запчастин: {САЙТ}`,
  },
  {
    key: "waiting",
    title: "4. Не забирає посилку",
    text: `Crane-Moto | Посилка №{номер} чекає на вас у відділенні 📬
ТТН: {ттн}
Будь ласка, заберіть її, поки діє безкоштовне зберігання. Якщо є питання — {ТЕЛ}`,
  },
  {
    key: "nocall",
    title: "5. Не додзвонилися",
    text: `Crane-Moto | Не змогли до вас додзвонитися щодо замовлення №{номер}.
Будь ласка, передзвоніть або напишіть у Viber/Telegram: {ТЕЛ}`,
  },
];

export const SHOP_FIELDS = [
  { key: "ТЕЛ", label: "Телефон магазину", ph: "+380 XX XXX XX XX" },
  { key: "VIBER", label: "Viber (посилання або номер)", ph: "https://viber.click/380XXXXXXXXX" },
  { key: "TG", label: "Telegram (посилання)", ph: "https://t.me/cranemoto" },
  { key: "ВІДГУК_GOOGLE", label: "Посилання на відгук Google", ph: "https://g.page/r/…/review" },
  { key: "ВІДГУК_PROM", label: "Посилання на відгуки Prom", ph: "https://prom.ua/c…-crane-moto.html#reviews" },
  { key: "САЙТ", label: "Сайт", ph: "https://crane-moto.com" },
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
  return { id: Number(o.id), name, firstName, phone, items, total, payment: str(o.payment_method ?? o.paymentMethod), delivery, ttn, cod, site };
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
