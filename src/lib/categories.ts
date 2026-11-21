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

export type CatOption = { id: string; name: string; path: string };

/** Усі відомі категорії SalesDrive: з YML + створені з додатку + вписані вручну з ID */
export async function allCategories(): Promise<CatOption[]> {
  const [treeRaw, createdRaw, customRaw] = await Promise.all([getSetting("ymlCategoryTree"), getSetting("createdCategories"), getSetting("customCategories")]);
  const byId = new Map<string, SdCategory>();
  for (const c of parse<SdCategory[]>(treeRaw, [])) byId.set(c.id, c);
  for (const c of parse<SdCategory[]>(createdRaw, [])) if (!byId.has(c.id)) byId.set(c.id, c);
  for (const l of parse<string[]>(customRaw, []).map(parseCustomLine)) if (l.id && !byId.has(l.id)) byId.set(l.id, { id: l.id, name: l.name, parentId: null });
  const pathOf = (c: SdCategory, depth = 0): string => {
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    return parent && depth < 10 ? pathOf(parent, depth + 1) + PATH_SEP + c.name : c.name;
  };
  return [...byId.values()].map((c) => ({ id: c.id, name: c.name, path: pathOf(c) })).sort((a, b) => a.path.localeCompare(b.path, "uk"));
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
  return all.find((c) => c.id === id) ?? { id, name: cat.name, path: cat.name };
}
