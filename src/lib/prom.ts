/**
 * Швидке оновлення наявності на Prom через API (між імпортами YML, які Prom робить раз на кілька годин).
 * Джерело правди — залишки SalesDrive (його YML): після замовлення SalesDrive сам списує товар, у т.ч. з карток-комплектів.
 * Відправляємо лише змінені товари і лише ті, що на Prom мають статус «в наявності» / «немає в наявності»
 * («під замовлення», «очікується», послуги — не чіпаємо).
 * Токен Prom (лише доступ до товарів) — у змінній PROM_API_TOKEN.
 */
import { db } from "./db";
import { fetchYmlText, parseYml } from "./salesdrive";
import { getSetting, setSetting } from "./util";

const API = "https://my.prom.ua/api/v1";
export const promConfigured = () => Boolean(process.env.PROM_API_TOKEN);

async function promFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.PROM_API_TOKEN}`, "Content-Type": "application/json", "X-LANGUAGE": "uk", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Prom ${path}: ${res.status} ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Prom ${path}: не JSON — ${text.slice(0, 200)}`);
  }
}

type PromProduct = {
  id: number | string;
  external_id?: string | null;
  sku?: string | null;
  name?: string | null;
  presence?: string | null;
  quantity_in_stock?: number | null;
  keywords?: string | null;
};

/** Повний список товарів Prom → таблиця PromLink (поточна наявність на Prom) */
export async function refreshPromMap() {
  const seen = new Set<string>();
  let lastId: string | null = null;
  for (let page = 0; page < 500; page++) {
    const q = new URLSearchParams({ limit: "100" });
    if (lastId) q.set("last_id", lastId);
    const r = await promFetch(`/products/list?${q}`);
    const list = (r.products ?? []) as PromProduct[];
    if (!list.length) break;
    for (const p of list) {
      const promId = String(p.id);
      if (seen.has(promId)) continue;
      seen.add(promId);
      const data = {
        externalId: p.external_id ? String(p.external_id) : null,
        sku: p.sku ? String(p.sku) : null,
        name: p.name ? String(p.name).slice(0, 255) : null,
        presence: p.presence ?? null,
        qty: typeof p.quantity_in_stock === "number" ? Math.round(p.quantity_in_stock) : null,
        ...(p.keywords !== undefined ? { keywordsUa: p.keywords ? String(p.keywords) : null } : {}),
      };
      await db.promLink.upsert({ where: { promId }, update: data, create: { promId, ...data } });
    }
    const nextId = String(list[list.length - 1].id);
    if (list.length < 100 || nextId === lastId) break;
    lastId = nextId;
  }
  if (seen.size) await db.promLink.deleteMany({ where: { promId: { notIn: [...seen] } } });
  await setSetting("promMapAt", new Date().toISOString());
  return seen.size;
}

export type PromChange = { promId: string; name: string | null; from: string; to: string; qty: number; presence: "available" | "not_available" };

/**
 * Порівняти залишки SalesDrive (YML) з Prom і відправити різницю.
 * dryRun — лише показати, що змінилося б.
 */
export async function promStockSync({ dryRun = false } = {}) {
  if (!promConfigured()) throw new Error("Немає PROM_API_TOKEN");
  // список товарів Prom — щогодини (так підхоплюємо нові товари після імпорту Prom), між цим знаємо, що самі відправили
  const mapAt = await getSetting("promMapAt");
  if (!mapAt || Date.now() - new Date(mapAt).getTime() > 3600e3 || dryRun) await refreshPromMap();

  const offers = parseYml(await fetchYmlText());
  const bySd = new Map<string, number | null>(offers.map((o) => [o.sdId, o.qty]));
  const skuCount = new Map<string, number>();
  for (const o of offers) if (o.sku) skuCount.set(o.sku.toUpperCase(), (skuCount.get(o.sku.toUpperCase()) ?? 0) + 1);
  const bySku = new Map<string, number | null>(offers.filter((o) => o.sku && skuCount.get(o.sku.toUpperCase()) === 1).map((o) => [o.sku!.toUpperCase(), o.qty]));

  const links = await db.promLink.findMany();
  let matched = 0;
  const unmatched: string[] = [];
  const changes: PromChange[] = [];
  for (const l of links) {
    // лише «в наявності» / «немає»: «під замовлення» й інші статуси — ваше рішення на Prom, не чіпаємо
    if (l.presence !== "available" && l.presence !== "not_available") continue;
    let q = l.externalId && bySd.has(l.externalId) ? bySd.get(l.externalId) : l.sku ? bySku.get(l.sku.toUpperCase()) : undefined;
    if (q === undefined) {
      // товар з ID імпорту, якого вже немає в SalesDrive (видалили) — знімаємо з наявності на Prom
      if (l.externalId && offers.length > 0) q = 0;
      else {
        unmatched.push(l.name ?? l.promId);
        continue;
      }
    }
    matched++;
    if (q === null) continue; // у YML немає кількості — не знаємо
    const qty = Math.max(0, Math.floor(q));
    const presence = qty > 0 ? "available" : "not_available";
    if (l.presence === presence && (l.qty ?? -1) === qty) continue;
    changes.push({ promId: l.promId, name: l.name, from: `${l.presence === "available" ? "є" : "немає"}${l.qty !== null ? `, ${l.qty} шт` : ""}`, to: `${presence === "available" ? "є" : "немає"}, ${qty} шт`, qty, presence });
  }

  // запобіжник: якщо раптом «немає в наявності» стає масово — це схоже на збій YML, нічого не відправляємо
  const toZero = changes.filter((c) => c.presence === "not_available").length;
  const guard = toZero > Math.max(10, matched * 0.3);
  const result = { at: new Date().toISOString(), prom: links.length, matched, unmatched: unmatched.length, changes: changes.length, sent: 0, errors: [] as string[], guard, dryRun };

  if (!dryRun && !guard && changes.length) {
    for (let i = 0; i < changes.length; i += 100) {
      const chunk = changes.slice(i, i + 100);
      try {
        const r = await promFetch("/products/edit", {
          method: "POST",
          body: JSON.stringify(chunk.map((c) => ({ id: Number(c.promId), presence: c.presence, quantity_in_stock: c.qty }))),
        });
        const failed = new Set<string>(Object.keys(r.errors ?? {}));
        for (const [id, err] of Object.entries(r.errors ?? {})) result.errors.push(`${id}: ${JSON.stringify(err).slice(0, 120)}`);
        for (const c of chunk) {
          if (failed.has(c.promId)) continue;
          await db.promLink.update({ where: { promId: c.promId }, data: { presence: c.presence, qty: c.qty, pushedAt: new Date() } });
          result.sent++;
        }
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
        break;
      }
    }
  }
  if (!dryRun) {
    await setSetting("promLast", JSON.stringify(result));
    if (result.sent) {
      const log = JSON.parse((await getSetting("promLog")) ?? "[]") as { at: string; name: string | null; from: string; to: string }[];
      const fresh = changes.slice(0, result.sent).map((c) => ({ at: result.at, name: c.name, from: c.from, to: c.to }));
      await setSetting("promLog", JSON.stringify([...fresh, ...log].slice(0, 50)));
    }
  }
  return { ...result, sample: changes.slice(0, 30), unmatchedSample: unmatched.slice(0, 15) };
}

/**
 * Дублі на Prom: товари, «ID імпорту» яких не з SalesDrive, хоча товар з тим самим артикулом
 * і правильним ID (= ID у SalesDrive) уже є. Імпорт YML їх не оновлює, а заявки по них SalesDrive не впізнає.
 */
export async function findPromDuplicates() {
  await refreshPromMap();
  const sdIds = new Set((await db.product.findMany({ where: { sdId: { not: null } }, select: { sdId: true } })).map((p) => p.sdId!));
  const links = await db.promLink.findMany();
  const goodSku = new Set(links.filter((l) => l.externalId && sdIds.has(l.externalId) && l.sku).map((l) => l.sku!.toUpperCase()));
  return links.filter((l) => !(l.externalId && sdIds.has(l.externalId)) && l.sku && goodSku.has(l.sku.toUpperCase()));
}

/** Приховати дублі з вітрини Prom (статус «не на сайті») — потім їх можна видалити в кабінеті Prom фільтром «Приховані» */
export async function hidePromDuplicates() {
  const dups = await findPromDuplicates();
  let hidden = 0;
  const errors: string[] = [];
  for (let i = 0; i < dups.length; i += 100) {
    const chunk = dups.slice(i, i + 100);
    try {
      const r = await promFetch("/products/edit", {
        method: "POST",
        body: JSON.stringify(chunk.map((d) => ({ id: Number(d.promId), status: "not_on_display", presence: "not_available" }))),
      });
      const failed = new Set<string>(Object.keys(r.errors ?? {}));
      for (const [id, err] of Object.entries(r.errors ?? {})) errors.push(`${id}: ${JSON.stringify(err).slice(0, 120)}`);
      hidden += chunk.filter((d) => !failed.has(d.promId)).length;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      break;
    }
  }
  return { found: dups.length, hidden, errors };
}

/**
 * Українські пошукові запити на Prom. SalesDrive віддає в YML лише російські, а Prom перекладає їх тільки при ручному
 * збереженні товару. Тут: беремо російські з SalesDrive (через додаток), перекладаємо (DeepL або словник)
 * і записуємо в українську версію товару на Prom (запит з X-LANGUAGE: uk).
 */
/** Prom ігнорує X-LANGUAGE при записі — запити потрапляють у російську версію. Вимкнено, доки не знайдемо правильне поле. */
export const PROM_UA_KW_ENABLED = false;

export async function promPushUaKeywords({
  limit = 50,
  onlyMissing = true,
  test = false,
  sdIds,
}: { limit?: number; onlyMissing?: boolean; test?: boolean; sdIds?: string[] } = {}) {
  if (!promConfigured()) throw new Error("Немає PROM_API_TOKEN");
  if (!PROM_UA_KW_ENABLED) throw new Error("Запис українських запитів на Prom тимчасово вимкнено: Prom записує їх у російську версію");
  if (!sdIds) await refreshPromMap();
  const products = await db.product.findMany({
    where: { deletedAt: null, sdId: sdIds ? { in: sdIds } : { not: null }, keywords: { not: null } },
    select: { sdId: true, sku: true, keywords: true, keywordsUa: true, name: true },
  });
  const bySd = new Map(products.map((p) => [p.sdId!, p]));
  const links = await db.promLink.findMany();
  const todo = links
    .map((l) => ({ l, p: l.externalId ? bySd.get(l.externalId) : undefined }))
    .filter((x) => x.p?.keywords?.trim() && (!onlyMissing || uaKeywordsMissing(x.l.keywordsUa, x.p.keywords)))
    .slice(0, test ? 1 : limit);
  if (!todo.length) return { candidates: 0, sent: 0, errors: [] as string[], sample: null as string | null };

  const { translate, translateConfigured } = await import("./translate");
  const { translateKeywords } = await import("./ruua");
  const src = todo.map((x) => x.p!.keywordsUa?.trim() || "");
  const need = todo.map((x, i) => (src[i] ? "" : x.p!.keywords!));
  let tr: string[] = need.map((t) => (t ? translateKeywords(t) : ""));
  if (translateConfigured() && need.some(Boolean)) {
    try {
      tr = await translate(need, "RU", "UK");
    } catch {
      /* залишаємо словниковий переклад */
    }
  }
  const values = todo.map((_, i) => src[i] || tr[i]);
  const errors: string[] = [];
  let sent = 0;
  for (let i = 0; i < todo.length; i += 50) {
    const chunk = todo.slice(i, i + 50);
    try {
      const r = await promFetch("/products/edit", {
        method: "POST",
        headers: { "X-LANGUAGE": "uk" },
        body: JSON.stringify(chunk.map((x, k) => ({ id: Number(x.l.promId), keywords: values[i + k] }))),
      });
      const failed = new Set<string>(Object.keys(r.errors ?? {}));
      for (const [id, err] of Object.entries(r.errors ?? {})) errors.push(`${id}: ${JSON.stringify(err).slice(0, 150)}`);
      for (const [k, x] of chunk.entries()) {
        if (failed.has(x.l.promId)) continue;
        await db.promLink.update({ where: { promId: x.l.promId }, data: { keywordsUa: values[i + k], kwPushedAt: new Date() } });
        sent++;
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      break;
    }
  }
  const first = todo[0];
  return {
    candidates: todo.length,
    sent,
    errors,
    sample: first ? `${first.p!.sku ?? ""} ${first.l.name ?? ""} (Prom ID ${first.l.promId}): ${values[0]}` : null,
  };
}

/** Українських запитів на Prom немає: порожньо, або Prom віддає російські замість українських */
export function uaKeywordsMissing(onProm: string | null | undefined, ru: string | null | undefined) {
  const v = onProm?.trim();
  if (!v) return true;
  if (ru && v.toLowerCase() === ru.trim().toLowerCase()) return true;
  return /[ыэъё]/i.test(v);
}

/** Живий стан товару на Prom: пошукові запити обома мовами */
export async function promProductInfo(sdId: string | null, sku: string | null) {
  if (!promConfigured()) throw new Error("Немає PROM_API_TOKEN");
  let link = sdId ? await db.promLink.findFirst({ where: { externalId: sdId } }) : null;
  if (!link && sku) link = await db.promLink.findFirst({ where: { sku } });
  if (!link) {
    await refreshPromMap();
    link = sdId ? await db.promLink.findFirst({ where: { externalId: sdId } }) : null;
    if (!link && sku) link = await db.promLink.findFirst({ where: { sku } });
  }
  if (!link) return null;
  const get = async (lang: "ru" | "uk") => {
    const r = await promFetch(`/products/${link!.promId}`, { headers: { "X-LANGUAGE": lang } });
    const p = (r.product ?? r) as Record<string, unknown> & { name?: string; keywords?: string; presence?: string; quantity_in_stock?: number };
    return { name: p.name ?? null, keywords: p.keywords ?? null, presence: p.presence ?? null, qty: p.quantity_in_stock ?? null, raw: p };
  };
  const [ru, uk] = await Promise.all([get("ru"), get("uk")]);
  // діагностика: які поля взагалі віддає Prom і чи є окремі мовні версії
  const raw = uk.raw;
  const fields = Object.keys(raw).sort().join(", ");
  const multilang: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (/multilang|_uk$|_ua$|_ru$|lang/i.test(k)) multilang[k] = v;
  const strip = (x: typeof ru) => ({ name: x.name, keywords: x.keywords, presence: x.presence, qty: x.qty });
  return { promId: link.promId, ru: strip(ru), uk: strip(uk), fields, multilang: JSON.stringify(multilang).slice(0, 3000), at: new Date().toISOString() };
}

/** Записати російські пошукові запити (з SalesDrive) назад на Prom — для відновлення */
export async function promRestoreRuKeywords(promId: string, keywords: string) {
  const r = await promFetch("/products/edit", { method: "POST", body: JSON.stringify([{ id: Number(promId), keywords }]) });
  const errs = Object.entries(r.errors ?? {}).map(([id, e]) => `${id}: ${JSON.stringify(e).slice(0, 200)}`);
  if (errs.length) throw new Error(errs.join("; "));
}
