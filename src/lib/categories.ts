import { db } from "./db";
import { getSetting } from "./util";

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

/**
 * ID категорії SalesDrive за назвою — щоб товар потрапив у наявну категорію,
 * а не SalesDrive створив нову з такою самою назвою.
 */
export async function categoryIdFor(name: string | null | undefined): Promise<string | null> {
  const n = name?.trim();
  if (!n) return null;
  const custom = parse<string[]>(await getSetting("customCategories"), []).map(parseCustomLine);
  const c = custom.find((x) => x.name === n && x.id);
  if (c) return c.id;
  const yml = parse<Record<string, string>>(await getSetting("ymlCategoryIds"), {});
  if (yml[n]) return yml[n];
  // запасний варіант: ID у наявних товарів з такою категорією
  const rows = await db.product.groupBy({ by: ["categorySdId"], where: { categoryName: n, categorySdId: { not: null } }, _count: true });
  rows.sort((a, b) => b._count - a._count);
  return rows[0]?.categorySdId ?? null;
}
