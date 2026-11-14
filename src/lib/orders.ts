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
  return v.replace(/[\s-]/g, "").toUpperCase();
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
  const filter: Record<string, string> = { "filter[statusId]": "__NOTDELETED__" };
  if (last) filter["filter[updateAt][from]"] = sdTime(new Date(new Date(last).getTime() - 10 * 60 * 1000));
  else filter["filter[orderTime][from]"] = sdTime(new Date(Date.now() - initialDays * 864e5));

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

  let page = 1;
  let pageCount = 1;
  let saved = 0;
  do {
    const r = await sdGet("/api/order/list/", { ...filter, limit: "100", page: String(page) });
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
      const data = {
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
    if (page <= pageCount) await new Promise((r) => setTimeout(r, 400)); // не навантажуємо API
  } while (page <= pageCount && page <= 300);

  await setSetting("lastOrderSync", started.toISOString());
  return { saved };
}
