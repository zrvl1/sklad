import { db } from "./db";
import { getSetting, setSetting } from "./util";
import type { SdCategory } from "./salesdrive";

export const PATH_SEP = " › ";

const parse = <T,>(v: string | null, d: T): T => {
  try {
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};

/** Рядок ручного списку: «Назва» або «Назва = 144376897» (ID категорії з SalesDrive) */
export function parseCustomLine(line: string): { name: string; id: string | null } {
  const m = /^(.*?)\s*=\s*(\d+)\s*$/.exec(line);
  return m ? { name: m[1].trim(), id: m[2] } : { name: line.trim(), id: null };
}

export type CatOption = { id: string; name: string; path: string; parentId: string | null; depth: number };

/** Усі відомі категорії SalesDrive: з YML + створені з додатку + вписані вручну з ID */
export async function allCategories(): Promise<CatOption[]> {
  const [treeRaw, createdRaw, customRaw] = await Promise.all([getSetting("ymlCategoryTree"), getSetting("createdCategories"), getSetting("customCategories")]);
  const byId = new Map<string, SdCategory>();
  for (const c of parse<SdCategory[]>(treeRaw, [])) byId.set(c.id, c);
  // створені/змінені в додатку — мають пріоритет (до наступної синхронізації, де їх уже віддасть SalesDrive)
  for (const c of parse<SdCategory[]>(createdRaw, [])) byId.set(c.id, c);
  for (const l of parse<string[]>(customRaw, []).map(parseCustomLine)) if (l.id && !byId.has(l.id)) byId.set(l.id, { id: l.id, name: l.name, parentId: null });
  const pathOf = (c: SdCategory, depth = 0): string => {
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    return parent && depth < 10 ? pathOf(parent, depth + 1) + PATH_SEP + c.name : c.name;
  };
  return [...byId.values()]
    .map((c) => {
      const path = pathOf(c);
      return { id: c.id, name: c.name, path, parentId: c.parentId, depth: path.split(PATH_SEP).length - 1 };
    })
    .sort((a, b) => a.path.localeCompare(b.path, "uk"));
}

/** Знайти категорію за повним шляхом або за назвою (якщо така назва одна) */
export async function findCategory(input: string | null | undefined): Promise<CatOption | null> {
  const v = input?.trim();
  if (!v) return null;
  const all = await allCategories();
  const byPath = all.find((c) => c.path === v);
  if (byPath) return byPath;
  const byName = all.filter((c) => c.name === v);
  return byName.length === 1 ? byName[0] : null;
}

/** ID категорії SalesDrive за назвою (для швидкого створення товару тощо) */
export async function categoryIdFor(name: string | null | undefined): Promise<string | null> {
  const n = name?.trim();
  if (!n) return null;
  const c = await findCategory(n);
  if (c) return c.id;
  const rows = await db.product.groupBy({ by: ["categorySdId"], where: { categoryName: n, categorySdId: { not: null } }, _count: true });
  rows.sort((a, b) => b._count - a._count);
  return rows[0]?.categorySdId ?? null;
}

/** Створити нову категорію в SalesDrive (і запам'ятати її в додатку) */
export async function createCategory(name: string, parentId: string | null): Promise<CatOption> {
  const { sdUpsertCategories, isSalesDriveConfigured } = await import("./salesdrive");
  const seq = Number((await getSetting("catSeq")) ?? "0") + 1;
  const id = String(900000000 + seq);
  const cat: SdCategory = { id, name: name.trim(), parentId: parentId || null };
  if (isSalesDriveConfigured()) await sdUpsertCategories([cat]);
  await setSetting("catSeq", String(seq));
  const created = parse<SdCategory[]>(await getSetting("createdCategories"), []);
  await setSetting("createdCategories", JSON.stringify([...created, cat]));
  const all = await allCategories();
  return all.find((c) => c.id === id) ?? { id, name: cat.name, path: cat.name, parentId: cat.parentId, depth: 0 };
}

/** Перейменувати / перенести категорію (в SalesDrive і в додатку) */
export async function updateCategory(id: string, name: string, parentId: string | null) {
  const { sdUpsertCategories } = await import("./salesdrive");
  const cat: SdCategory = { id, name: name.trim(), parentId: parentId || null };
  await sdUpsertCategories([cat]);
  const created = parse<SdCategory[]>(await getSetting("createdCategories"), []).filter((c) => c.id !== id);
  await setSetting("createdCategories", JSON.stringify([...created, cat]));
  await db.product.updateMany({ where: { categorySdId: id }, data: { categoryName: cat.name } });
}

/**
 * Створити дерево категорій одним запитом до SalesDrive.
 * paths — рядки «Мотоблоки › Двигуни» (можна «>» або «/»); наявні рівні використовуються, відсутні — створюються.
 */
export async function createCategoryTree(paths: string[]) {
  const { sdUpsertCategories, isSalesDriveConfigured } = await import("./salesdrive");
  const all = await allCategories();
  const byPath = new Map(all.map((c) => [c.path.toLowerCase(), c.id]));
  let seq = Number((await getSetting("catSeq")) ?? "0");
  const fresh: SdCategory[] = [];
  for (const raw of paths) {
    const parts = raw
      .split(/\s*(?:›|>|\/)\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
    let parentId: string | null = null;
    let path = "";
    for (const name of parts) {
      path = path ? path + PATH_SEP + name : name;
      const key = path.toLowerCase();
      let id = byPath.get(key);
      if (!id) {
        seq++;
        id = String(900000000 + seq);
        fresh.push({ id, name, parentId });
        byPath.set(key, id);
      }
      parentId = id;
    }
  }
  if (!fresh.length) return { created: 0, paths: [] as string[] };
  if (isSalesDriveConfigured()) for (let i = 0; i < fresh.length; i += 50) await sdUpsertCategories(fresh.slice(i, i + 50));
  await setSetting("catSeq", String(seq));
  const created = parse<SdCategory[]>(await getSetting("createdCategories"), []);
  await setSetting("createdCategories", JSON.stringify([...created, ...fresh]));
  const after = await allCategories();
  return { created: fresh.length, paths: fresh.map((f) => after.find((c) => c.id === f.id)?.path ?? f.name) };
}

/**
 * Видалити категорію в додатку й SalesDrive.
 * Товари переносяться в targetId (або в батьківську категорію), підкатегорії — у батьківську.
 */
export async function deleteCategory(id: string, targetId: string | null) {
  const all = await allCategories();
  const cat = all.find((c) => c.id === id);
  if (!cat) throw new Error("Категорію не знайдено");
  const tId = targetId || cat.parentId;
  const target = tId ? all.find((c) => c.id === tId) ?? null : null;
  if (target && (target.id === id || target.path.startsWith(cat.path + PATH_SEP))) throw new Error("Не можна переносити товари в саму категорію чи її підкатегорію");

  const products = await db.product.findMany({ where: { categorySdId: id } });
  const active = products.filter((p) => !p.deletedAt);
  if (active.length && !target) throw new Error(`У категорії ${active.length} товарів — оберіть, куди їх перенести`);

  // 1) підкатегорії — на рівень вище
  const children = all.filter((c) => c.parentId === id);
  for (const c of children) await updateCategory(c.id, c.name, cat.parentId);

  // 2) товари — у нову категорію (у нас і в SalesDrive)
  if (products.length)
    await db.product.updateMany({ where: { categorySdId: id }, data: { categorySdId: target?.id ?? null, categoryName: target?.name ?? null } });
  const { isSalesDriveConfigured, productToSd, sdUpdateProducts, sdDeleteCategories } = await import("./salesdrive");
  let sdNote = "";
  if (isSalesDriveConfigured()) {
    const moved = await db.product.findMany({ where: { id: { in: active.map((p) => p.id) }, sdId: { not: null } } });
    for (let i = 0; i < moved.length; i += 100) await sdUpdateProducts(moved.slice(i, i + 100).map((p) => productToSd(p, null, {})));
    // 3) сама категорія
    try {
      await sdDeleteCategories([id]);
    } catch (e) {
      sdNote = ` SalesDrive не видалив категорію (${e instanceof Error ? e.message : e}) — видаліть її там вручну; товарів у ній уже немає.`;
    }
  }

  // 4) прибрати з додатку
  const drop = <T extends { id: string }>(list: T[]) => list.filter((c) => c.id !== id);
  await setSetting("ymlCategoryTree", JSON.stringify(drop(parse<SdCategory[]>(await getSetting("ymlCategoryTree"), []))));
  await setSetting("createdCategories", JSON.stringify(drop(parse<SdCategory[]>(await getSetting("createdCategories"), []))));
  await setSetting("customCategories", JSON.stringify(parse<string[]>(await getSetting("customCategories"), []).filter((l) => parseCustomLine(l).id !== id)));
  // зіставлення категорій фіду постачальника
  const map = parse<Record<string, string>>(await getSetting("feedCategoryMap"), {});
  for (const [k, v] of Object.entries(map)) {
    if (v === cat.path) {
      if (target) map[k] = target.path;
      else delete map[k];
    } else if (v.startsWith(cat.path + PATH_SEP)) map[k] = (cat.parentId ? all.find((c) => c.id === cat.parentId)!.path + PATH_SEP : "") + v.slice(cat.path.length + PATH_SEP.length);
  }
  await setSetting("feedCategoryMap", JSON.stringify(map));
  return { name: cat.name, moved: active.length, target: target?.path ?? null, children: children.length, sdNote };
}
