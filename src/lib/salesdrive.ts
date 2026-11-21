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
  // назва поля країни в API SalesDrive не задокументована — передаємо поширені варіанти, зайві SalesDrive ігнорує
  countryManufacturer?: string;
  keywords?: string;
  keywordsTranslate?: string;
  images?: { fullsize: string; thumbnail: string }[]; // фото за посиланнями — SalesDrive завантажує їх сам // українською (якщо SalesDrive двомовний)
  manufacturerCountry?: string;
  country?: string;
  supplier?: string;
  discount?: { value: string; date_start: string; date_end: string };
  stockBalance?: string;
  stockBalanceByStock?: Record<string, string>;
  category?: { id?: string; name?: string };
  description?: string;
  descriptionTranslate?: string;
  params?: ProductParam[];
  paramsMode?: "add" | "replace";
  set?: { id: string; quantity: number }[]; // склад комплекту: ID товарів SalesDrive і кількість
};

export type ProductParam = { name: string; type: string; value: string };

export function parseParams(json: string | null | undefined): ProductParam[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => x && x.name).map((x) => ({ name: String(x.name), type: String(x.type || "text"), value: String(x.value ?? "") })) : [];
  } catch {
    return [];
  }
}

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
  opts: {
    withName?: boolean;
    withPrice?: boolean;
    withCost?: boolean;
    withDetails?: boolean;
    paramsMode?: "add" | "replace";
    set?: { id: string; quantity: number }[];
    withImages?: boolean;
  } = {}
): SdProductPayload {
  if (!p.sdId) throw new Error(`У товару "${p.name}" немає ID для SalesDrive`);
  const payload: SdProductPayload = { id: p.sdId };
  if (opts.set?.length) payload.set = opts.set;
  if (opts.withImages && p.images) {
    try {
      const urls = (JSON.parse(p.images) as string[]).filter((u) => /^https?:\/\//.test(u));
      // власні фото додатку (/img/<id>) — з розширенням, інакше SalesDrive може їх не завантажити
      const withExt = (u: string) => (/\/img\/[a-z0-9]+$/i.test(u) ? `${u}.jpg` : u);
      if (urls.length) payload.images = urls.map((u) => ({ fullsize: withExt(u), thumbnail: withExt(u) }));
    } catch {}
  }
  if (opts.withName) {
    // в обидва мовні поля (UA і RU) — для нових товарів або коли назву змінили
    payload.name = p.name;
    payload.nameTranslate = p.nameTranslate?.trim() || p.name;
  }
  if (opts.withDetails) {
    // опис — в обидва мовні поля (як і назва); характеристики — повним списком із заміною
    if (p.description !== null) {
      payload.description = p.description;
      payload.descriptionTranslate = p.descriptionTranslate?.trim() ? p.descriptionTranslate : p.description;
    }
    if (p.keywords?.trim()) {
      payload.keywords = p.keywords;
      // українські — лише справжні (копія російських потрапила б на Prom в українську версію)
      if (p.keywordsUa?.trim()) payload.keywordsTranslate = p.keywordsUa;
    }
    const params = parseParams(p.params).filter((x) => x.value.trim());
    if (params.length) {
      // порожній список не шлемо ніколи — щоб випадково не стерти характеристики в CRM
      payload.params = params;
      // replace — коли ми знаємо всі характеристики товару (прочитані з YML); add — коли не знаємо, щоб не стерти чужі
      payload.paramsMode = opts.paramsMode ?? "replace";
    }
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
  if (p.country) payload.countryManufacturer = payload.manufacturerCountry = payload.country = p.country;
  if (p.supplierName) payload.supplier = p.supplierName;
  if (p.categorySdId || p.categoryName) {
    payload.category = {};
    // ID + назва (лише ID SalesDrive не приймає: 422 "name - required field")
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

async function saveSdDebug(sent: unknown, status: number, response: string) {
  try {
    const { setSetting } = await import("./util");
    const { getSetting } = await import("./util");
    const entry = { at: new Date().toISOString(), status, sent: JSON.stringify(sent).slice(0, 3000), response: response.slice(0, 3000) };
    let log: unknown[] = [];
    try {
      const prev = JSON.parse((await getSetting("sdResponseLog")) ?? "[]");
      if (Array.isArray(prev)) log = prev;
    } catch {}
    await setSetting("sdResponseLog", JSON.stringify([entry, ...log].slice(0, 8)));
    await setSetting("lastSdResponse", JSON.stringify(entry));
  } catch {
    /* діагностика не повинна ламати роботу */
  }
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
    // для діагностики: що саме відправили і що відповів SalesDrive (без ключа)
    await saveSdDebug(chunk, res.status, text);
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

/** Видалити товари в SalesDrive (потрібне право «Товари: видалення») */
export async function sdDeleteProducts(ids: string[]) {
  const { url, key } = config();
  for (let i = 0; i < ids.length; i += 100) {
    const res = await fetch(`${url}/product-handler/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({ form: key, action: "delete", product: ids.slice(i, i + 100).map((id) => ({ id })) }),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`SalesDrive відповів ${res.status}: ${text.slice(0, 300)}`);
    let d: { success?: boolean; status?: string; error?: unknown; message?: string } | null = null;
    try {
      d = JSON.parse(text);
    } catch {}
    if (d && (d.success === false || d.status === "error" || d.error)) throw new Error(`SalesDrive: ${d.message ?? JSON.stringify(d.error ?? d).slice(0, 300)}`);
  }
}

// ---------- Читання YML ----------

export type YmlOffer = {
  sdId: string;
  name: string;
  nameTranslate: string | undefined; // друга мова, якщо YML її віддає
  descriptionTranslate: string | undefined;
  price: number;
  priceCurrency: string | null;
  description: string | null | undefined; // undefined — у YML немає опису (вимкнено в експорті)
  params: ProductParam[] | undefined;
  cost: number | null;
  sku: string | null;
  barcode: string | null;
  manufacturer: string | null;
  country: string | null;
  images: string[] | undefined; // фото з YML (undefined — тегів picture немає взагалі)
  keywords: string | null | undefined; // undefined — у YML немає тегу
  keywordsUa: string | null | undefined;
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

// Службові «характеристики», які ми читаємо як окремі поля товару
const SERVICE_PARAMS = new Set(["собівартість", "себестоимость", "sku", "артикул", "штрихкод", "штрих-код", "barcode", "виробник", "производитель"]);

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
export type SdCategory = { id: string; name: string; parentId: string | null };

/** Усі категорії з YML: дерево (id, назва, батьківська) */
export function parseYmlCategories(xml: string): SdCategory[] {
  const doc = ymlParser.parse(xml);
  const shop = doc?.yml_catalog?.shop ?? doc?.shop ?? {};
  const out: SdCategory[] = [];
  for (const c of (shop.categories?.category ?? []) as Record<string, unknown>[]) {
    const name = text(c as Node)?.trim();
    const id = text(c["@_id"] as Node);
    const parentId = text(c["@_parentId"] as Node) ?? null;
    if (name && id) out.push({ id, name, parentId });
  }
  return out;
}

/** Створити/оновити категорії в SalesDrive */
export async function sdUpsertCategories(cats: SdCategory[]) {
  const { url, key } = config();
  const res = await fetch(`${url}/category-handler/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": key },
    body: JSON.stringify({ form: key, action: "update", category: cats.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId ?? "" })) }),
    cache: "no-store",
  });
  const text = await res.text();
  await saveSdDebug(cats, res.status, text);
  if (!res.ok) throw new Error(`SalesDrive відповів ${res.status}: ${text.slice(0, 300)}`);
  try {
    const d = JSON.parse(text) as { status?: string; errors?: unknown; message?: string };
    if (d.status === "error") throw new Error(`SalesDrive: ${JSON.stringify(d.errors ?? d.message).slice(0, 300)}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("SalesDrive")) throw e;
  }
}

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
        original: text(p["@_name"] as Node) ?? "",
        value: text(p as Node),
      }));
      const param = (...names: string[]) => params.find((p) => names.includes(p.name))?.value ?? null;

      const sdId = text(o["@_id"] as Node);
      const mainName = text(o.name as Node) ?? text(o.model as Node) ?? "(без назви)";
      const mainDesc = "description" in o ? text(o.description as Node) : undefined;
      // друга мова: теги name_ua / name_ru (формат Prom); якщо збігається з основною — це не переклад
      const trName = text(o.name_ua as Node) ?? text(o.name_ru as Node);
      const trDesc = text(o.description_ua as Node) ?? text(o.description_ru as Node);
      const categoryId = text(o.categoryId as Node);
      return {
        sdId: sdId ?? "",
        name: mainName,
        // українська версія з SalesDrive — навіть якщо збігається з російською (тоді це й треба побачити й виправити)
        nameTranslate: trName ?? undefined,
        descriptionTranslate: trDesc ?? undefined,
        price: firstNum(text(o.price as Node)) ?? 0,
        priceCurrency: text(o.currencyId as Node)?.toUpperCase() ?? null,
        description: "description" in o ? text(o.description as Node) : undefined,
        params: "param" in o ? params.filter((p) => !SERVICE_PARAMS.has(p.name)).map((p) => ({ name: p.original, type: "text", value: p.value ?? "" })) : undefined,
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
        images: Array.isArray(o.picture) ? (o.picture as Node[]).map((x) => text(x)).filter((x): x is string => Boolean(x)) : undefined,
        keywords: "keywords" in o ? text(o.keywords as Node) : "search_queries" in o ? text(o.search_queries as Node) : undefined,
        keywordsUa: "keywords_ua" in o ? text(o.keywords_ua as Node) : "keywords_uk" in o ? text(o.keywords_uk as Node) : undefined,
        country: param("країна виробник", "країна-виробник", "страна производитель", "страна-производитель") ?? text(o.country_of_origin as Node)?.split(/\s+/)[0] ?? text(o.country as Node),
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
