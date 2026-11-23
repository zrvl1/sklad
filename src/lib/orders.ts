import { fixLayout } from "./scan";
/**
 * Продажі із SalesDrive для звітів.
 * Окремий ключ SALESDRIVE_ORDERS_KEY з правами лише на читання: «Заявки» і «Статуси заявки».
 * Зберігаємо тільки товари, суми й статуси — ПІБ, телефони й адреси клієнтів НЕ зберігаємо.
 */
import { db } from "./db";
import { getSetting, setSetting } from "./util";

export function ordersEnabled() {
  return Boolean(process.env.SALESDRIVE_URL && process.env.SALESDRIVE_ORDERS_KEY);
}

// SalesDrive: не більше 10 запитів списку заявок за хвилину — тримаємо паузу ≥ 6,5 с між ними
let lastListCall = 0;
async function sdGetList(params: Record<string, string>) {
  const wait = lastListCall + 6500 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastListCall = Date.now();
  try {
    return await sdGet("/api/order/list/", params);
  } catch (e) {
    if (!/limit reached/i.test(String(e))) throw e;
    await new Promise((r) => setTimeout(r, 61_000)); // ліміт уже вичерпано (напр. інший запит) — чекаємо хвилину
    lastListCall = Date.now();
    return await sdGet("/api/order/list/", params);
  }
}

async function sdGet(path: string, params: Record<string, string> = {}) {
  const url = process.env.SALESDRIVE_URL!.replace(/\/+$/, "");
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}${path}${qs ? `?${qs}` : ""}`, {
    headers: { "X-Api-Key": process.env.SALESDRIVE_ORDERS_KEY! },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SalesDrive ${path}: ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/** Нормалізація номера ТТН: без пробілів і дефісів, великими літерами (NP: 14 цифр, Укрпошта: цифри або RR…UA) */
export function normTtn(v: string) {
  return fixLayout(v).replace(/[\s-]/g, "").toUpperCase();
}

export type SdStatus = { id: number; name: string; type: number };

export async function fetchStatuses(): Promise<SdStatus[]> {
  const r = await sdGet("/api/statuses/");
  const list = ((r.data ?? []) as SdStatus[]).map((s) => ({ id: Number(s.id), name: String(s.name), type: Number(s.type) }));
  await setSetting("sdStatuses", JSON.stringify(list));
  return list;
}

export async function cachedStatuses(): Promise<SdStatus[]> {
  const raw = await getSetting("sdStatuses");
  return raw ? JSON.parse(raw) : [];
}

const sdTime = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const parseTime = (s: unknown) => (s ? new Date(String(s).replace(" ", "T")) : null);
const numOr0 = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

type RawProduct = { productId?: unknown; text?: unknown; sku?: unknown; barcode?: unknown; amount?: unknown; price?: unknown; discount?: unknown; costPrice?: unknown };

/** Значення поля заявки: рядок, число, {name|text|value} або перший елемент масиву */
function scalar(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.length ? scalar(v[0]) : null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return scalar(o.text ?? o.name ?? o.title ?? o.value ?? null);
  }
  const s = String(v).trim();
  return s && s !== "0" && s.toLowerCase() !== "null" ? s.slice(0, 120) : null;
}

/**
 * Поля заявки для аналітики реклами: сайт, UTM-мітки, комісія, дата продажу.
 * Назви полів у API SalesDrive залежать від налаштувань, тому шукаємо за схожістю назви ключа.
 * Контактні дані клієнта не беремо.
 */
export function orderAnalytics(o: Record<string, unknown>) {
  const keys = Object.keys(o);
  const find = (re: RegExp, not?: RegExp) => {
    for (const k of keys) if (re.test(k) && !(not && not.test(k))) {
      const v = scalar(o[k]);
      if (v) return v;
    }
    return null;
  };
  const num = (v: string | null) => (v ? Number(v.replace(",", ".")) || 0 : 0);
  const sale = find(/sale_?date|saledate|data_?prodaz|dataprodaz|prodazh/i);
  return {
    utmSource: scalar(o.utmSource) ?? find(/utm_?source$/i),
    utmMedium: scalar(o.utmMedium) ?? find(/utm_?medium/i),
    utmCampaign: scalar(o.utmCampaign) ?? find(/utm_?campaign/i),
    site: scalar(o.sajt) ?? find(/^(sait|site|shop|sayt)$/i),
    commission: num(scalar(o.commissionAmount) ?? find(/komis|kommis|commission/i)),
    saleDate: (() => {
      const d = sale ? parseTime(sale) : null;
      return d && !Number.isNaN(d.getTime()) ? d : null;
    })(),
  };
}

/**
 * Завантажити заявки: перший раз — за останні `initialDays` днів (за датою створення),
 * далі — лише змінені з минулої синхронізації (за датою оновлення).
 */
export async function syncOrders(initialDays = 90) {
  if (!ordersEnabled()) throw new Error("Не налаштовано SALESDRIVE_ORDERS_KEY");
  // статуси потрібні для збирання і звітів — підтягуємо раз на добу або якщо їх ще немає
  const stAt = await getSetting("sdStatusesAt");
  if (!stAt || Date.now() - Number(stAt) > 864e5) {
    try {
      await fetchStatuses();
      await setSetting("sdStatusesAt", String(Date.now()));
    } catch {
      /* немає права на статуси — не заважає */
    }
  }
  const last = await getSetting("lastOrderSync");
  const started = new Date();
  if (!last) {
    // перше завантаження — великим обсягом, тому порціями у фоні (див. backfillOrders)
    await startBackfill(initialDays);
    await setSetting("lastOrderSync", started.toISOString());
    return { saved: 0, backfill: true };
  }
  const filter: Record<string, string> = {
    "filter[statusId]": "__NOTDELETED__",
    "filter[updateAt][from]": sdTime(new Date(new Date(last).getTime() - 10 * 60 * 1000)),
  };
  const r = await fetchOrderPages(filter, 1, 8);
  // якщо змін більше, ніж 8 сторінок, — решту доберемо наступного разу (час не зсуваємо)
  if (r.done) await setSetting("lastOrderSync", started.toISOString());
  return { saved: r.saved };
}

type Backfill = { from: string; to: string; page: number; saved: number; pages: number | null };

/** Почати фонове перезавантаження заявок за N днів (порціями по 8 сторінок, щоб не впертися в ліміт API) */
export async function startBackfill(days: number) {
  const b: Backfill = { from: sdTime(new Date(Date.now() - days * 864e5)), to: sdTime(new Date()), page: 1, saved: 0, pages: null };
  await setSetting("orderBackfill", JSON.stringify(b));
}

export async function backfillState() {
  const raw = await getSetting("orderBackfill");
  return raw ? (JSON.parse(raw) as Backfill) : null;
}

/** Один крок фонового завантаження (≈ 1 хвилина). Викликається кроном і кнопкою. */
export async function backfillOrders() {
  const b = await backfillState();
  if (!b || !ordersEnabled()) return null;
  const filter = { "filter[statusId]": "__NOTDELETED__", "filter[orderTime][from]": b.from, "filter[orderTime][to]": b.to };
  const r = await fetchOrderPages(filter, b.page, 8);
  const next: Backfill = { ...b, page: r.nextPage, saved: b.saved + r.saved, pages: r.pageCount };
  if (r.done) await db.setting.deleteMany({ where: { key: "orderBackfill" } });
  else await setSetting("orderBackfill", JSON.stringify(next));
  return { ...next, done: r.done };
}

/** Завантажити до maxPages сторінок заявок, починаючи з firstPage */
async function fetchOrderPages(filter: Record<string, string>, firstPage: number, maxPages: number) {
  // Для зіставлення рядків заявок з нашими товарами
  const products = await db.product.findMany({ select: { id: true, sdId: true, sku: true, barcode: true, name: true } });
  const bySd = new Map(products.filter((p) => p.sdId).map((p) => [p.sdId!, p.id]));
  const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku!, p.id]));
  const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode!, p.id]));
  const byName = new Map(products.map((p) => [p.name.toLowerCase(), p.id]));
  const match = (x: RawProduct) => {
    const sku = x.sku ? String(x.sku) : "";
    const bc = x.barcode ? String(x.barcode) : "";
    return (
      (bc && byBarcode.get(bc)) || (sku && bySku.get(sku)) || bySd.get(String(x.productId ?? "")) || byName.get(String(x.text ?? "").toLowerCase()) || null
    );
  };

  let page = firstPage;
  let pageCount = firstPage;
  let saved = 0;
  let keysSaved = false;
  let fetched = 0;
  do {
    const r = await sdGetList({ ...filter, limit: "100", page: String(page) });
    fetched++;
    pageCount = Number(r.pagination?.pageCount) || 1;
    for (const o of (r.data ?? []) as Record<string, unknown>[]) {
      const id = Number(o.id);
      if (!id) continue;
      const lines = ((o.products ?? []) as RawProduct[]).map((x) => ({
        productId: match(x),
        sdProductId: x.productId !== undefined ? String(x.productId) : null,
        name: String(x.text ?? ""),
        sku: x.sku ? String(x.sku) : null,
        barcode: x.barcode ? String(x.barcode) : null,
        qty: numOr0(x.amount),
        price: numOr0(x.price),
        discount: numOr0(x.discount),
        costPrice: numOr0(x.costPrice),
      }));
      if (!keysSaved) {
        // назви полів (без значень) — щоб бачити, що віддає SalesDrive
        await setSetting("sdOrderKeys", JSON.stringify(Object.keys(o)));
        keysSaved = true;
      }
      const data = {
        ...orderAnalytics(o),
        orderTime: parseTime(o.orderTime) ?? new Date(),
        updateAt: parseTime(o.updateAt),
        statusId: numOr0(o.statusId),
        amount: numOr0(o.paymentAmount),
        costAmount: numOr0(o.costPriceAmount),
        profit: numOr0(o.profitAmount),
      };
      // ТТН із даних доставки (номер відправлення — не персональні дані клієнта)
      const ttns = [
        ...new Set(
          ((o.ord_delivery_data ?? []) as Record<string, unknown>[])
            .flatMap((d) => [d.trackingNumber, d.parentTrackingNumber])
            .filter((t): t is string | number => t !== null && t !== undefined && String(t).trim() !== "")
            .map((t) => normTtn(String(t)))
        ),
      ];
      await db.$transaction([
        db.sdOrderLine.deleteMany({ where: { orderId: id } }),
        db.sdOrder.upsert({ where: { id }, update: data, create: { id, ...data } }),
        db.sdOrderLine.createMany({ data: lines.map((l) => ({ ...l, orderId: id })) }),
        db.orderTtn.deleteMany({ where: { OR: [{ orderId: id }, { ttn: { in: ttns } }] } }),
        db.orderTtn.createMany({ data: ttns.map((ttn) => ({ ttn, orderId: id })), skipDuplicates: true }),
      ]);
      saved++;
    }
    page++;
  } while (page <= pageCount && fetched < maxPages);
  return { saved, nextPage: page, pageCount, done: page > pageCount };
}

/**
 * Одна заявка з контактами — ЛИШЕ для показу менеджеру (шаблон повідомлення клієнту).
 * Нічого з контактних даних не зберігаємо в базі.
 */
export async function fetchOrderLive(id: number): Promise<Record<string, unknown> | null> {
  if (!ordersEnabled()) throw new Error("Не налаштовано SALESDRIVE_ORDERS_KEY");
  // SalesDrive може ігнорувати невідомий фільтр і віддати останні заявки — тому завжди звіряємо id
  const tries: Record<string, string>[] = [
    { "filter[id]": String(id), limit: "5" },
    { "filter[id][from]": String(id), "filter[id][to]": String(id), limit: "5" },
    { "filter[id][]": String(id), limit: "5" },
  ];
  // формат фільтра, що спрацював минулого разу, — першим (кожен запит списку = пауза 6,5 с)
  const known = Number((await getSetting("sdIdFilter")) ?? "-1");
  const order = known >= 0 && known < tries.length ? [known, ...tries.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...tries.keys()];
  for (const i of order) {
    try {
      const r = await sdGetList(tries[i]);
      await rememberFieldOptions(r?.meta);
      const hit = ((r?.data ?? []) as Record<string, unknown>[]).find((o) => Number(o.id) === id);
      if (hit) {
        if (i !== known) await setSetting("sdIdFilter", String(i));
        return hit;
      }
    } catch {
      /* пробуємо інший формат фільтра */
    }
  }
  // запасний шлях: останні змінені заявки (2 сторінки по 100)
  for (let page = 1; page <= 2; page++) {
    const r = await sdGetList({ limit: "100", page: String(page), "filter[updateAt][from]": sdTime(new Date(Date.now() - 30 * 864e5)) });
    const hit = ((r?.data ?? []) as Record<string, unknown>[]).find((o) => Number(o.id) === id);
    if (hit) return hit;
  }
  return null;
}

/** Довідники полів заявки (сайт, спосіб оплати…) з meta відповіді SalesDrive: { поле: { id: назва } } */
async function rememberFieldOptions(meta: unknown) {
  if (!meta || typeof meta !== "object") return;
  const fields = ((meta as Record<string, unknown>).fields ?? meta) as Record<string, unknown>;
  const out: Record<string, Record<string, string>> = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    const opts = (v && typeof v === "object" ? ((v as Record<string, unknown>).options ?? (v as Record<string, unknown>).values) : null) as unknown;
    if (!Array.isArray(opts)) continue;
    const m: Record<string, string> = {};
    for (const o of opts as Record<string, unknown>[]) {
      const val = o.value ?? o.id;
      const text = o.text ?? o.name ?? o.title;
      if (val !== undefined && text) m[String(val)] = String(text);
    }
    if (Object.keys(m).length) out[k] = m;
  }
  if (Object.keys(out).length) await setSetting("sdFieldOptions", JSON.stringify(out));
}

export async function fieldOptions(): Promise<Record<string, Record<string, string>>> {
  try {
    return JSON.parse((await getSetting("sdFieldOptions")) ?? "{}");
  } catch {
    return {};
  }
}

/**
 * Заявки з вибраними статусами — наживо з SalesDrive (для списку «Повідомлення клієнту»).
 * Видалені або переведені в інший статус заявки зникають самі. Контакти не зберігаємо.
 */
export async function fetchOrdersByStatusLive(statusIds: number[]): Promise<Record<string, unknown>[]> {
  if (!ordersEnabled()) throw new Error("Не налаштовано SALESDRIVE_ORDERS_KEY");
  const out: Record<string, unknown>[] = [];
  for (const st of statusIds.slice(0, 3)) {
    const r = await sdGetList({ "filter[statusId]": String(st), limit: "100", page: "1" });
    await rememberFieldOptions(r?.meta);
    out.push(...((r?.data ?? []) as Record<string, unknown>[]));
  }
  return out;
}
