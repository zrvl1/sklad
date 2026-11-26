/**
 * Фід постачальника (XML/YML): довідник товарів за кодом, РРЦ × курс, створення карток.
 * Формат як у TT AGRO MOTO: <offer><code/><article/><name/><price/><currency/><description/><available/><param name=…/><pictures><picture/></pictures></offer>
 * Підтримує й класичний YML (<offer id=…><vendorCode/><picture/>…).
 */
import { XMLParser } from "fast-xml-parser";
import { db } from "./db";
import { getRates } from "./currency";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name: string) => ["offer", "param", "picture", "item", "product", "category"].includes(name),
});

type Node = unknown;
const txt = (v: Node): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return txt((v as Record<string, unknown>)["#text"] ?? "");
  return String(v).trim();
};
const num = (v: Node) => {
  const n = Number(txt(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export type FeedItem = {
  code: string;
  article: string | null;
  name: string;
  price: number;
  currency: string;
  available: boolean;
  category: string | null;
  brand: string | null;
  description: string | null;
  params: { name: string; value: string }[];
  pictures: string[];
};

function findOffers(doc: Record<string, unknown>): Record<string, unknown>[] {
  // шукаємо масив offer будь-де в документі
  const stack: unknown[] = [doc];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      if ((k === "offer" || k === "item" || k === "product") && Array.isArray(v) && v.length && typeof v[0] === "object") return v as Record<string, unknown>[];
      if (typeof v === "object") stack.push(v);
    }
  }
  return [];
}

/** Дерево категорій фіду (<categories><category id parentId>Назва</category>) → id → повний шлях */
function feedCategoryPaths(doc: Record<string, unknown>): Map<string, string> {
  const raw = new Map<string, { name: string; parent: string | null }>();
  const stack: unknown[] = [doc];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      if (k === "offer" || k === "item" || k === "product") continue; // всередині товарів <category> — це лише id
      if (k === "category" && Array.isArray(v)) {
        for (const c of v as Record<string, unknown>[]) {
          if (c && typeof c === "object" && c["@_id"] !== undefined) {
            const parent = txt(c["@_parentId"] ?? c["@_parent_id"] ?? c["@_parentid"]);
            raw.set(txt(c["@_id"]), { name: txt(c), parent: parent || null });
          }
        }
      } else if (typeof v === "object") stack.push(v);
    }
  }
  const paths = new Map<string, string>();
  const pathOf = (id: string, depth = 0): string => {
    const c = raw.get(id);
    if (!c) return "";
    const up = c.parent && depth < 8 ? pathOf(c.parent, depth + 1) : "";
    if (!c.name) return up; // категорія без назви — товари лишаються в батьківській
    return up ? `${up} › ${c.name}` : c.name;
  };
  for (const id of raw.keys()) paths.set(id, pathOf(id));
  return paths;
}

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const catPaths = feedCategoryPaths(doc);
  const out: FeedItem[] = [];
  for (const o of findOffers(doc)) {
    const params = ((o.param ?? []) as Record<string, unknown>[])
      .map((p) => ({ name: txt(p["@_name"]), value: txt(p) }))
      .filter((p) => p.name && p.value);
    const pv = (re: RegExp) => params.find((p) => re.test(p.name))?.value ?? null;
    const picsNode = (o.pictures as Record<string, unknown> | undefined)?.picture ?? o.picture ?? [];
    const pictures = (Array.isArray(picsNode) ? picsNode : [picsNode]).map(txt).filter((u) => /^https?:\/\//i.test(u));
    const code = txt(o.code) || txt(o["@_id"]) || txt(o.vendorCode);
    const name = txt(o.name) || txt(o.model);
    if (!code || !name) continue;
    const avail = txt(o.available ?? o["@_available"]).toLowerCase();
    out.push({
      code,
      article: txt(o.article) || txt(o.vendorCode) || null,
      name,
      price: num(o.price),
      currency: (txt(o.currency) || txt(o.currencyId) || "UAH").toUpperCase().replace("UAN", "UAH"),
      available: avail === "" ? true : avail === "true" || avail === "1" || avail === "yes",
      // категорія: з дерева фіду за id (повний шлях), інакше з характеристики «Категорія»
      category:
        catPaths.get(txt(Array.isArray(o.category) ? o.category[0] : o.category) || txt(Array.isArray(o.categoryId) ? o.categoryId[0] : o.categoryId)) ||
        pv(/^категорія$/i) ||
        (txt(o.categoryName) || null),
      brand: pv(/^(виробник|бренд|brand)$/i) ?? (txt(o.vendor) || null),
      description: txt(o.description) || null,
      params,
      pictures,
    });
  }
  return out;
}

/** Ціна продажу з РРЦ: РРЦ × курс, округлено вгору до roundTo грн */
export function priceFromRrp(rrp: number, currency: string, rates: Record<string, number>, roundTo = 10) {
  const rate = currency === "UAH" ? 1 : rates[currency];
  if (!rate || !(rrp > 0)) return null;
  const uah = rrp * rate;
  const step = roundTo > 0 ? roundTo : 1;
  return Math.ceil(uah / step) * step;
}

/** Завантажити фід постачальника: оновити довідник, РРЦ і ціни прив'язаних товарів */
export async function refreshSupplierFeed(supplierId: number) {
  const s = await db.supplier.findUniqueOrThrow({ where: { id: supplierId } });
  if (!s.feedUrl) throw new Error("Не вказано посилання на фід");
  let items: FeedItem[];
  try {
    const { robustGet } = await import("./robustFetch");
    const res = await robustGet(s.feedUrl, 90000);
    if (res.status < 200 || res.status >= 300) throw new Error(`фід відповів ${res.status}`);
    const head = res.body.subarray(0, 200).toString("latin1");
    const enc = head.match(/encoding=["']([\w-]+)["']/i)?.[1]?.toLowerCase() ?? "utf-8";
    items = parseFeed(new TextDecoder(enc === "utf8" ? "utf-8" : enc).decode(res.body));
    if (!items.length) throw new Error("у фіді не знайдено жодного товару (<offer>)");
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    // «fetch failed» сам по собі нічого не каже — додаємо причину (таймаут, відмова з'єднання, DNS…)
    const cause = e instanceof Error ? (e.cause as { code?: string; message?: string } | undefined) : undefined;
    if (cause) msg += ` (${[cause.code, cause.message].filter(Boolean).join(": ")})`;
    await db.supplier.update({ where: { id: supplierId }, data: { feedError: msg.slice(0, 300) } });
    throw new Error(msg);
  }
  // великі фіди: нові — пачками, наявні — лише ті, що змінилися (інакше Vercel не встигне)
  type Row = { id: number; code: string } & Record<string, unknown>;
  const sig = (d: Record<string, unknown>) =>
    JSON.stringify([d.article, d.name, d.price, d.currency, d.available, d.category, d.brand, d.description, d.params, d.pictures]);
  const existing = new Map<string, { id: number; sig: string }>(
    ((await db.supplierItem.findMany({ where: { supplierId } })) as Row[]).map((i) => [i.code, { id: i.id, sig: sig(i) }])
  );
  const seen = new Set<string>();
  const toCreate: Record<string, unknown>[] = [];
  const toUpdate: { id: number; data: Record<string, unknown> }[] = [];
  for (const it of items) {
    if (seen.has(it.code)) continue;
    seen.add(it.code);
    const data = {
      article: it.article,
      name: it.name.slice(0, 500),
      price: it.price,
      currency: it.currency,
      available: it.available,
      category: it.category,
      brand: it.brand,
      description: it.description,
      params: JSON.stringify(it.params),
      pictures: JSON.stringify(it.pictures),
    };
    const ex = existing.get(it.code);
    if (!ex) toCreate.push({ supplierId, code: it.code, ...data });
    else if (ex.sig !== sig(data)) toUpdate.push({ id: ex.id, data });
  }
  // змінені — пачками в одній транзакції (тисячі окремих запитів Vercel не встигає)
  for (let i = 0; i < toUpdate.length; i += 200)
    await db.$transaction(toUpdate.slice(i, i + 200).map((u) => db.supplierItem.update({ where: { id: u.id }, data: u.data })));
  const updated = toUpdate.length;
  for (let i = 0; i < toCreate.length; i += 500) await db.supplierItem.createMany({ data: toCreate.slice(i, i + 500), skipDuplicates: true });
  // зникли з фіду — немає в наявності
  const gone = [...existing.keys()].filter((c) => !seen.has(c));
  if (gone.length) await db.supplierItem.updateMany({ where: { supplierId, code: { in: gone } }, data: { available: false } });
  await db.supplier.update({ where: { id: supplierId }, data: { feedAt: new Date(), feedError: null } });
  const prices = await syncRrpPrices(supplierId);
  return { items: seen.size, created: toCreate.length, updated, gone: gone.length, ...prices };
}

/**
 * Для товарів постачальника: РРЦ з фіду → product.rrp; ціна = РРЦ × курс (якщо не зафіксована вручну).
 * Змінені ціни — у SalesDrive (звідти на сайт і Prom) і на картки-комплекти.
 */
export type FeedIssue = { productId: number; name: string; code: string; issue: string };

/** Категорії з ручними цінами (і всі їхні підкатегорії): ціну не чіпаємо, лише оновлюємо РРЦ для довідки */
export async function manualPriceCategoryIds(raw: string | null | undefined) {
  let roots: string[] = [];
  try {
    roots = JSON.parse(raw ?? "[]");
  } catch {}
  if (!roots.length) return new Set<string>();
  const { allCategories } = await import("./categories");
  const cats = await allCategories();
  const out = new Set<string>(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of cats) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) (out.add(c.id), (grew = true));
  }
  return out;
}

/**
 * Для товарів постачальника: РРЦ з фіду (за кодом постачальника) → product.rrp; ціна = РРЦ × курс,
 * якщо ціна не зафіксована вручну і категорія не в «ручних цінах». Перевірки — список проблем у налаштуваннях постачальника.
 * Змінені ціни — у SalesDrive (звідти на сайт і Prom) і на картки-комплекти.
 */
export async function syncRrpPrices(supplierId?: number) {
  const suppliers = await db.supplier.findMany({ where: supplierId ? { id: supplierId } : { feedUrl: { not: null } } });
  const rates = await getRates();
  const changed: number[] = [];
  let issuesTotal = 0;
  for (const s of suppliers) {
    // товари постачальника: створені з фіду або з прив’язаним кодом цього постачальника
    const products = await db.product.findMany({
      where: {
        deletedAt: null,
        baseProductId: null,
        OR: [{ supplierId: s.id, supplierCode: { not: null } }, { codes: { some: { supplierId: s.id, type: "supplier" } } }],
      },
      include: { codes: { where: { supplierId: s.id, type: "supplier" }, select: { code: true } } },
    });
    const issues: FeedIssue[] = [];
    if (products.length) {
      const allCodes = [...new Set(products.flatMap((p) => [p.supplierCode, ...p.codes.map((c) => c.code)]).filter((c): c is string => Boolean(c)))];
      type Item = { code: string; article: string | null; price: number; currency: string; available: boolean };
      const rows = (await db.supplierItem.findMany({
        where: { supplierId: s.id, OR: [{ code: { in: allCodes } }, { article: { in: allCodes } }] },
        select: { code: true, article: true, price: true, currency: true, available: true },
      })) as Item[];
      const byCode = new Map<string, Item>();
      for (const r of rows) {
        byCode.set(r.code, r);
        if (r.article && !byCode.has(r.article)) byCode.set(r.article, r);
      }
      const manual = await manualPriceCategoryIds(s.manualPriceCats);
      for (const p of products) {
        const codes = [p.supplierCode, ...p.codes.map((c) => c.code)].filter((c): c is string => Boolean(c));
        const it = codes.map((c) => byCode.get(c)).find(Boolean);
        const name = p.nameTranslate || p.name;
        const code = it?.code ?? codes[0] ?? "";
        if (!it) {
          issues.push({ productId: p.id, name, code, issue: "немає у фіді постачальника (код не знайдено)" });
          continue;
        }
        const data: { rrp?: number; rrpCurrency?: string; price?: number; supplierId?: number; supplierCode?: string } = {};
        if (p.supplierId !== s.id || p.supplierCode !== it.code) (data.supplierId = s.id), (data.supplierCode = it.code); // прив’язка за кодом
        if (!it.available) issues.push({ productId: p.id, name, code, issue: "немає в наявності у постачальника" });
        if (s.feedPriceType === "rrp") {
          if (!(it.price > 0)) {
            issues.push({ productId: p.id, name, code, issue: "у фіді немає ціни (РРЦ = 0)" });
          } else if (p.rrp !== it.price || p.rrpCurrency !== it.currency) {
            data.rrp = it.price;
            data.rrpCurrency = it.currency;
          }
        }
        const rrp = data.rrp ?? p.rrp;
        const cur = data.rrpCurrency ?? p.rrpCurrency ?? s.currency;
        const isManual = Boolean(p.categorySdId && manual.has(p.categorySdId));
        if (!p.priceLocked && !isManual && rrp && it.price > 0) {
          const np = priceFromRrp(rrp, cur, rates, s.roundTo);
          if (!np) issues.push({ productId: p.id, name, code, issue: `немає курсу ${cur} — ціну не перераховано` });
          else if (np !== p.price) data.price = np;
        }
        if (Object.keys(data).length) {
          await db.product.update({ where: { id: p.id }, data });
          if (data.price !== undefined) changed.push(p.id);
        }
      }
    }
    issuesTotal += issues.length;
    const { setSetting } = await import("./util");
    await setSetting(`feedIssues:${s.id}`, JSON.stringify({ at: new Date().toISOString(), checked: products.length, issues }));
  }
  if (changed.length) await pushPrices(changed);
  return { pricesChanged: changed.length, issues: issuesTotal };
}

async function pushPrices(ids: number[]) {
  const { isSalesDriveConfigured, productToSd, sdUpdateProducts } = await import("./salesdrive");
  const { propagatePriceToKits } = await import("./kits");
  if (isSalesDriveConfigured()) {
    const ps = await db.product.findMany({ where: { id: { in: ids }, sdId: { not: null } } });
    for (let i = 0; i < ps.length; i += 100) {
      try {
        await sdUpdateProducts(ps.slice(i, i + 100).map((p) => productToSd(p, null, { withPrice: true })));
      } catch {
        /* не зупиняємо — помилка видна в «Останні відповіді SalesDrive» */
      }
    }
  }
  await propagatePriceToKits(ids);
}

/** Опис для сайту з характеристик постачальника: єдиний стиль — таблиця «Характеристики» */
export function paramsHtml(params: { name: string; value: string }[]) {
  const skip = /^(категорія|призначення|гарантія|країна виробник|габарити упаковки, мм)$/i;
  const rows = params.filter((p) => !skip.test(p.name));
  if (!rows.length) return "";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const extra = params.filter((p) => /^(призначення|гарантія|країна виробник)$/i.test(p.name));
  return [
    "<h3>Характеристики</h3>",
    "<table>",
    ...rows.map((p) => `<tr><td>${esc(p.name)}</td><td><b>${esc(p.value)}</b></td></tr>`),
    "</table>",
    ...extra.map((p) => `<p><b>${esc(p.name)}:</b> ${esc(p.value)}</p>`),
  ].join("\n");
}

/** Текст у кінці кожного опису (перевірка сумісності / зв'язок) — UA і RU */
export const DEFAULT_FOOTER_UA =
  "<p><b>Перед замовленням перевірте сумісність</b> — звірте модель техніки та розміри зі своєю деталлю. Не впевнені або потрібні точні розміри запчастини? Напишіть або зателефонуйте нам — підкажемо по сумісності та за потреби заміряємо деталь.</p>";
export const DEFAULT_FOOTER_RU =
  "<p><b>Перед заказом проверьте совместимость</b> — сверьте модель техники и размеры со своей деталью. Не уверены или нужны точные размеры запчасти? Напишите или позвоните нам — подскажем по совместимости и при необходимости замерим деталь.</p>";
export async function descFooters() {
  const { getSetting } = await import("./util");
  const [ua, ru] = await Promise.all([getSetting("descFooterUa"), getSetting("descFooterRu")]);
  return { ua: ua ?? DEFAULT_FOOTER_UA, ru: ru ?? DEFAULT_FOOTER_RU };
}

/** Характеристики «за замовчуванням» для товарів постачальника (країна, стан) */
export const DEFAULT_EXTRA_PARAMS = "Країна виробник: Китай\nСтан: Новий";
export function parseExtraParams(text: string | null | undefined) {
  return (text ?? DEFAULT_EXTRA_PARAMS)
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([^:]+?)\s*:\s*(.+?)\s*$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ name: m[1], value: m[2] }));
}
/** Додати/замінити характеристики постачальника за замовчуванням */
export function withExtraParams(params: { name: string; value: string }[], extra: { name: string; value: string }[]) {
  const out = params.filter((p) => !extra.some((e) => e.name.toLowerCase() === p.name.toLowerCase()));
  return [...out, ...extra];
}
