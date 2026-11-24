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
