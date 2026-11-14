/**
 * Робота з API SalesDrive.
 *
 * Запис товарів:  POST {SALESDRIVE_URL}/product-handler/   (до 100 товарів за запит)
 *   Поля SalesDrive: costPerItem = ЦІНА продажу, expenses = СОБІВАРТІСТЬ,
 *   stockBalance = залишок (один склад), stockBalanceByStock = {"id складу": "к-сть"}.
 *   Дати знижки — у форматі ДД.ММ.РРРР.
 * Читання товарів: YML-посилання (Установки → Товари/Послуги → Експорт YML).
 */
import { XMLParser } from "fast-xml-parser";
import type { Product } from "@prisma/client";

export type SdProductPayload = {
  id: string;
  name?: string;
  nameTranslate?: string; // друга мова назви (при двомовності в SalesDrive)
  nameForDocuments?: string;
  costPerItem?: string;
  currency?: string; // валюта ціни продажу
  expenses?: string;
  currencyExpenses?: string; // валюта собівартості
  sku?: string;
  barcode?: string;
  manufacturer?: string;
  supplier?: string;
  discount?: { value: string; date_start: string; date_end: string };
  stockBalance?: string;
  stockBalanceByStock?: Record<string, string>;
  category?: { id?: string; name?: string };
};

function config() {
  const url = process.env.SALESDRIVE_URL?.replace(/\/+$/, "");
  const key = process.env.SALESDRIVE_FORM_KEY;
  if (!url || !key) throw new Error("Не налаштовано SALESDRIVE_URL або SALESDRIVE_FORM_KEY у .env");
  return { url, key };
}

export function isSalesDriveConfigured() {
  return Boolean(process.env.SALESDRIVE_URL && process.env.SALESDRIVE_FORM_KEY);
}

function sdDate(d: Date | null) {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/**
 * Дані товару для SalesDrive.
 * Надсилаємо ЛИШЕ заповнені поля: частини полів (собівартість, постачальник, назва для документів)
 * немає в YML, тож у нашій базі вони можуть бути порожніми — і порожнім значенням ми б затерли їх у CRM.
 * Назву, ціну й собівартість — лише коли їх справді змінили (opts), і завжди разом із валютою,
 * щоб не зламати товари, де ціна чи закупівля в SalesDrive задані в доларах/євро.
 */
export function productToSd(
  p: Product,
  stock?: { sdStockId: string | null; qty: number } | null,
  opts: { withName?: boolean; withPrice?: boolean; withCost?: boolean } = {}
): SdProductPayload {
  if (!p.sdId) throw new Error(`У товару "${p.name}" немає ID для SalesDrive`);
  const payload: SdProductPayload = { id: p.sdId };
  if (opts.withName) {
    // в обидва мовні поля (UA і RU) — для нових товарів або коли назву змінили
    payload.name = p.name;
    payload.nameTranslate = p.name;
  }
  if (opts.withPrice) {
    payload.costPerItem = String(p.price);
    payload.currency = p.priceCurrency ?? "UAH";
  }
  if (opts.withCost) {
    const inCurrency = p.costCurrency && p.costCurrency !== "UAH" && p.costOriginal !== null;
    payload.expenses = String(inCurrency ? p.costOriginal : p.cost);
    payload.currencyExpenses = inCurrency ? p.costCurrency! : "UAH";
  }
  if (p.nameForDocuments) payload.nameForDocuments = p.nameForDocuments;
  if (p.sku) payload.sku = p.sku;
  if (p.barcode) payload.barcode = p.barcode;
  if (p.manufacturer) payload.manufacturer = p.manufacturer;
  if (p.supplierName) payload.supplier = p.supplierName;
  if (p.categorySdId || p.categoryName) {
    payload.category = {};
    if (p.categorySdId) payload.category.id = p.categorySdId;
    if (p.categoryName) payload.category.name = p.categoryName;
  }
  if (p.discountValue && p.discountValue > 0) {
    payload.discount = {
      value: p.discountType === "amount" ? String(p.discountValue) : `${p.discountValue}%`,
      date_start: sdDate(p.discountFrom),
      date_end: sdDate(p.discountTo),
    };
  }
  if (stock) {
    if (stock.sdStockId) payload.stockBalanceByStock = { [stock.sdStockId]: String(stock.qty) };
    else payload.stockBalance = String(stock.qty);
  }
  return payload;
}

/** Додати/оновити товари в SalesDrive */
export async function sdUpdateProducts(products: SdProductPayload[]) {
  const { url, key } = config();
  for (let i = 0; i < products.length; i += 100) {
    const chunk = products.slice(i, i + 100);
    const res = await fetch(`${url}/product-handler/`, {
      method: "POST",
      // Новий формат API-ключів SalesDrive передає ключ заголовком X-Api-Key, старий — полем "form"; надсилаємо обидва
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({ form: key, action: "update", product: chunk }),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`SalesDrive відповів ${res.status}: ${text.slice(0, 300)}`);
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* не JSON — вважаємо успіхом, якщо статус 2xx */
    }
    const d = data as { success?: boolean; status?: string; error?: unknown; message?: string } | null;
    if (d && (d.success === false || d.status === "error" || d.error)) {
      throw new Error(`SalesDrive: ${d.message ?? JSON.stringify(d.error ?? d).slice(0, 300)}`);
    }
  }
}

// ---------- Читання YML ----------

export type YmlOffer = {
  sdId: string;
  name: string;
  price: number;
  priceCurrency: string | null;
  cost: number | null;
  sku: string | null;
  barcode: string | null;
  manufacturer: string | null;
  categoryId: string | null;
  categoryName: string | null;
  qty: number | null;
};

type Node = Record<string, unknown> | string | number | undefined | null;

function text(v: Node | Node[]): string | null {
  if (Array.isArray(v)) return text(v[0]);
  if (v === undefined || v === null) return null;
  if (typeof v === "object") {
    const t = (v as Record<string, unknown>)["#text"];
    return t === undefined || t === null ? null : String(t).trim() || null;
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}

function firstNum(...vals: (string | null)[]) {
  for (const v of vals) {
    if (v === null) continue;
    const n = parseFloat(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export const ymlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name: string) => ["offer", "category", "param", "picture", "barcode"].includes(name),
});

export async function fetchYmlText() {
  const url = process.env.SALESDRIVE_YML_URL;
  if (!url) throw new Error("Не налаштовано SALESDRIVE_YML_URL у .env");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`YML недоступний: ${res.status}`);
  return res.text();
}

/**
 * Розбір YML. Назви тегів у різних CRM трохи відрізняються, тому перевіряємо кілька варіантів.
 * Якщо якесь поле не підтягується — запустіть `npm run yml:inspect` і допишіть потрібний тег тут.
 */
export function parseYml(xml: string): YmlOffer[] {
  const doc = ymlParser.parse(xml);
  const shop = doc?.yml_catalog?.shop ?? doc?.shop ?? {};
  const cats = new Map<string, string>();
  for (const c of (shop.categories?.category ?? []) as Record<string, unknown>[]) {
    const id = text(c["@_id"] as Node);
    const name = text(c as Node);
    if (id && name) cats.set(id, name);
  }

  const offers = (shop.offers?.offer ?? []) as Record<string, unknown>[];
  return offers
    .map((o) => {
      const params = ((o.param ?? []) as Record<string, unknown>[]).map((p) => ({
        name: (text(p["@_name"] as Node) ?? "").toLowerCase(),
        value: text(p as Node),
      }));
      const param = (...names: string[]) => params.find((p) => names.includes(p.name))?.value ?? null;

      const sdId = text(o["@_id"] as Node);
      const categoryId = text(o.categoryId as Node);
      return {
        sdId: sdId ?? "",
        name: text(o.name as Node) ?? text(o.model as Node) ?? "(без назви)",
        price: firstNum(text(o.price as Node)) ?? 0,
        priceCurrency: text(o.currencyId as Node)?.toUpperCase() ?? null,
        cost: firstNum(
          text(o.vendorprice as Node), // так SalesDrive передає собівартість
          text(o.cost_price as Node),
          text(o.purchase_price as Node),
          text(o.expenses as Node),
          param("собівартість", "себестоимость")
        ),
        sku: text(o.vendorCode as Node) ?? text(o.sku as Node) ?? text(o.article as Node) ?? param("sku", "артикул"),
        barcode: text(o.barcode as Node) ?? param("штрихкод", "штрих-код", "barcode"),
        manufacturer: text(o.vendor as Node) ?? param("виробник", "производитель"),
        categoryId,
        categoryName: categoryId ? cats.get(categoryId) ?? null : null,
        qty: firstNum(
          text(o.quantity_in_stock as Node),
          text(o.stock_quantity as Node),
          text(o.quantity as Node),
          text(o.count as Node),
          text(o["@_quantity"] as Node)
        ),
      } satisfies YmlOffer;
    })
    .filter((o) => o.sdId);
}
