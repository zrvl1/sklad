/**
 * Шаблони повідомлень клієнтам (Viber / Telegram / SMS) із підстановкою даних заявки SalesDrive.
 * Дані клієнта беруться з SalesDrive в момент показу і ніде не зберігаються.
 */
import { getSetting } from "./util";

export type MsgTemplate = { key: string; title: string; text: string };

const ASK = "Якщо виникнуть питання — пишіть у цей чат або телефонуйте на цей номер.";

export const DEFAULT_TEMPLATES: MsgTemplate[] = [
  {
    key: "acceptedPaid",
    title: "1. Прийнято — оплачено онлайн",
    text: `Crane-Moto | Замовлення №{номер} прийнято ✅

Добрий день, {ім'я}! Дякуємо за замовлення, оплату отримали.

{товари}
Сума: {сума} грн
Доставка: {доставка}
Отримувач: {піб}, {телефон}

🚚 {відправка}. ТТН надішлемо окремим повідомленням.
⚠️ Під час повітряної тривоги відділення Нової пошти зачиняються, тому відправка може перенестися на найближчий рейс.

Помітили помилку в даних? Напишіть у відповідь.
${ASK}`,
  },
  {
    key: "acceptedCod",
    title: "2. Прийнято — накладений платіж",
    text: `Crane-Moto | Замовлення №{номер}

Добрий день, {ім'я}! Дякуємо за замовлення.

{товари}
Сума: {сума} грн — оплата при отриманні
Доставка: {доставка}
Отримувач: {піб}, {телефон}

🚚 {відправка}, ТТН надішлемо окремим повідомленням.
⚠️ Під час повітряної тривоги відділення Нової пошти зачиняються, тому відправка може перенестися на найближчий рейс.

${ASK}`,
  },
  {
    key: "accepted17",
    title: "2б. Прийнято — відправимо сьогодні до 17:00",
    text: `Crane-Moto | Замовлення №{номер}

Добрий день, {ім'я}! Дякуємо за замовлення.

{товари}
Сума: {сума} грн{оплата_рядок}
Доставка: {доставка}
Отримувач: {піб}, {телефон}

🚚 Відправимо сьогодні до 17:00, ТТН надішлемо окремим повідомленням.
⚠️ Під час повітряної тривоги відділення Нової пошти зачиняються, тому відправка може перенестися на найближчий рейс.

Якщо виникнуть питання — пишіть у цей чат або телефонуйте на цей номер.`,
  },
  {
    key: "acceptedLate",
    title: "2а. Прийнято після робочого часу — відправка завтра",
    text: `Crane-Moto | Замовлення №{номер} прийнято ✅

Добрий день, {ім'я}! Дякуємо за замовлення.

{товари}
Сума: {сума} грн{оплата_рядок}
Доставка: {доставка}
Отримувач: {піб}, {телефон}

🚚 Відправимо завтра до 12:00 і надішлемо ТТН.
⚠️ Під час повітряної тривоги відділення Нової пошти зачиняються, тому відправка може перенестися.

Якщо є питання або хочете змінити чи скасувати замовлення — напишіть у цей чат або зателефонуйте в робочий час: Пн-Пт 10-17, Сб-Нд 10-16.`,
  },
  {
    key: "shipped",
    title: "3. Відправлено",
    text: `Crane-Moto | Замовлення №{номер} відправлено 📦

ТТН: {ттн}
{до_сплати}Відстежити: https://novaposhta.ua/tracking/{ттн}

${ASK}`,
  },
  {
    key: "delay",
    title: "4. Відправка переноситься (тривога)",
    text: `Crane-Moto | Замовлення №{номер}

{ім'я}, через повітряну тривогу відділення Нової пошти сьогодні зачинене, тому відправка переноситься на завтра до 12:00. Перепрошуємо за незручності!
ТТН залишається та сама: {ттн}`,
  },
  {
    key: "noStock",
    title: "5. Немає в наявності — скасування",
    text: `Crane-Moto | Замовлення №{номер}

Добрий день, {ім'я}! На жаль, товару «{назви}» зараз немає в наявності, тому замовлення буде скасовано.
Перепрошуємо за незручності!`,
  },
  {
    key: "nocall",
    title: "6. Не вдалося зв'язатися",
    text: `Crane-Moto | Замовлення №{номер}

{ім'я}, не змогли до вас додзвонитися, щоб підтвердити замовлення.
Будь ласка, напишіть у відповідь «Так» або передзвоніть на цей номер. Якщо не вдасться зв'язатися, замовлення буде скасовано.`,
  },
  {
    key: "returnInfo",
    title: "7. Повернення",
    text: `Crane-Moto | Повернення за замовленням №{номер}

{ім'я}, оформіть, будь ласка, повернення через «Легке повернення» в застосунку Нової пошти — покроково зі скріншотами:
{ПОВЕРНЕННЯ}

Якщо «Легке повернення» не вийде, надішліть товар Новою поштою на:
{АДРЕСА_ПОВЕРНЕННЯ}
і напишіть у цей чат номер ТТН.

Кошти повертаємо після отримання й перевірки товару.

Доставку повернення оплачує магазин, якщо товар з браком або сталася помилка з нашого боку. В інших випадках доставку оплачує покупець.`,
  },
];

export const SHOP_FIELDS = [
  { key: "ТЕЛ", label: "Телефон магазину", ph: "+380 XX XXX XX XX" },
  { key: "VIBER", label: "Viber (посилання або номер)", ph: "https://viber.click/380XXXXXXXXX" },
  { key: "TG", label: "Telegram (посилання)", ph: "https://t.me/cranemoto" },
  { key: "ВІДГУК_GOOGLE", label: "Посилання на відгук Google", ph: "https://g.page/r/…/review" },
  { key: "ВІДГУК_PROM", label: "Посилання на відгуки Prom", ph: "https://prom.ua/c…-crane-moto.html#reviews" },
  { key: "САЙТ", label: "Сайт", ph: "https://crane-moto.com" },
  { key: "ПОВЕРНЕННЯ", label: "Сторінка на сайті «Повернення та обмін»", ph: "https://crane-moto.com/povernennya/" },
  { key: "АДРЕСА_ПОВЕРНЕННЯ", label: "Куди надсилати повернення (ПІБ, телефон, місто, відділення)", ph: "Прізвище Ім'я, 0XXXXXXXXX, м. …, відділення №…" },
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
  extId: string; // зовнішній номер замовлення (сайт/Prom) — його бачить клієнт
  time: string;
  statusId: number;
  name: string;
  firstName: string;
  phone: string;
  items: string;
  titles: string;
  total: number;
  payment: string;
  delivery: string;
  ttn: string;
  cod: number;
  site: string;
};

/** Назва з довідника SalesDrive замість id (сайт 19 → crane-moto.com, оплата 6 → «Накладений платіж») */
export function nameFromOptions(opts: Record<string, Record<string, string>>, keys: string[], v: string) {
  if (!v || !/^\d+$/.test(v)) return v;
  for (const k of keys) if (opts[k]?.[v]) return opts[k][v];
  return v;
}

export function parseOrder(o: Record<string, unknown>, opts: Record<string, Record<string, string>> = {}): OrderInfo {
  const c = (o.primaryContact ?? (Array.isArray(o.contacts) ? o.contacts[0] : null) ?? {}) as Record<string, unknown>;
  const firstName = str(c.fName);
  const name = [str(c.lName), firstName, str(c.mName)].filter(Boolean).join(" ");
  const shortName = [str(c.lName), firstName].filter(Boolean).join(" ");
  const phone = str(Array.isArray(c.phone) ? c.phone[0] : c.phone).replace(/[^\d+]/g, "");
  const products = (o.products ?? []) as Record<string, unknown>[];
  const items = products
    .map((p) => `• ${str(p.text ?? p.name)} × ${num(p.amount) || 1} — ${money(num(p.price) * (num(p.amount) || 1) - num(p.discount))} грн`)
    .join("\n");
  const titles = products.map((p) => str(p.text ?? p.name)).filter(Boolean).join("», «");
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
  return {
    id: Number(o.id),
    extId: str(o.externalId ?? o.external_id ?? o.externalNumber),
    time: str(o.orderTime),
    statusId: Number(o.statusId) || 0,
    name,
    firstName: shortName || firstName,
    phone,
    items,
    titles,
    total,
    payment: nameFromOptions(opts, ["payment_method", "paymentMethod"], str(o.payment_method ?? o.paymentMethod)),
    delivery,
    ttn,
    cod,
    site: nameFromOptions(opts, ["sajt", "site", "sait"], site),
  };
}

/**
 * Коли відправимо — залежно від того, о котрій зараз (Київ) надсилається повідомлення:
 * до 11:30 → сьогодні до 12:00; до 16:30 (Пн–Пт) → сьогодні до 17:00; інакше → завтра до 12:00.
 */
export function shipLine(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const m = Number(g("hour")) * 60 + Number(g("minute"));
  const weekend = g("weekday") === "Sat" || g("weekday") === "Sun";
  if (m < 11 * 60 + 30) return "Відправимо сьогодні до 12:00";
  if (!weekend && m < 16 * 60 + 30) return "Відправимо сьогодні до 17:00";
  return "Відправимо завтра до 12:00";
}

/** Підставити дані заявки й контакти магазину в шаблон */
export function fill(text: string, o: OrderInfo, shop: Record<string, string>) {
  const isProm = /prom/i.test(o.site);
  const vars: Record<string, string> = {
    // клієнт знає номер замовлення з сайту / Prom, а не внутрішній номер SalesDrive
    номер: o.extId || String(o.id),
    номер_заявки: String(o.id),
    відправка: shipLine(),
    "ім'я": o.firstName || "",
    піб: o.name,
    телефон: o.phone,
    товари: o.items,
    назви: o.titles,
    сума: money(o.total),
    оплата: o.payment || "—",
    доставка: o.delivery,
    ттн: o.ttn || "(ще немає ТТН)",
    оплата_рядок: o.cod > 0 || /наклад|післяплат|при отрим/i.test(o.payment) ? " — оплата при отриманні" : o.payment ? ` — ${o.payment}` : "",
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
export function suggestTemplate(o: OrderInfo, now = new Date()): string {
  const kyiv = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
  const h = kyiv.getHours() + kyiv.getMinutes() / 60;
  const weekend = kyiv.getDay() === 0 || kyiv.getDay() === 6;
  const close = weekend ? 16 : 17;
  // після 16:00 уже не встигаємо на вечірню відправку; до 10:00 — ще неробочий час, але відправка сьогодні
  if (h >= 16 || h >= close) return "acceptedLate";
  if (o.cod > 0 || /наклад|післяплат|при отрим|cash|cod/i.test(o.payment)) return "acceptedCod";
  if (/оплачен|monobank|plata|карт|онлайн|liqpay|передоплат/i.test(o.payment)) return "acceptedPaid";
  return "acceptedCod";
}
