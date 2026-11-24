/**
 * SEO-тексти пакетом через файл: вивантаження товарів (дані постачальника + підказки) → тексти дописуються
 * (вручну або в чаті з Claude) → завантаження назад: назви, описи, запити, характеристики → SalesDrive.
 */
import { db } from "./db";
import { allCategories } from "./categories";
import { parseParams } from "./salesdrive";

export const SEO_COLS = [
  "ID",
  "Артикул",
  "Код постачальника",
  "Категорія",
  "Назва зараз UA",
  "Назва зараз RU",
  "Бренд",
  "Характеристики",
  "Підказка (сумісність, моделі, ваші нотатки)",
  "НОВА назва UA",
  "НОВА назва RU",
  "НОВИЙ опис UA (HTML)",
  "НОВИЙ опис RU (HTML)",
  "Запити UA",
  "Запити RU",
  "Характеристики додати/змінити (Назва: значення, кожна з нового рядка)",
] as const;

export type SeoScope = "new" | "feed" | "category" | "ids";

export function seoWhere(scope: SeoScope, opts: { categoryId?: string; ids?: number[] }) {
  const base = { deletedAt: null, baseProductId: null };
  if (scope === "ids") return { ...base, id: { in: opts.ids ?? [] } };
  if (scope === "category") return { ...base, categorySdId: opts.categoryId ?? "-" };
  if (scope === "feed") return { ...base, supplierCode: { not: null } };
  // нові з XML, тексти ще не правились і SEO не завантажувалось
  return { ...base, supplierCode: { not: null }, seoAt: null, textEditedAt: null };
}

export async function seoRows(where: object, limit = 300) {
  const [ps, cats] = await Promise.all([db.product.findMany({ where, orderBy: { id: "asc" }, take: limit }), allCategories()]);
  const pathOf = new Map(cats.map((c) => [c.id, c.path]));
  const rows: string[][] = [[...SEO_COLS]];
  for (const p of ps) {
    const params = parseParams(p.params)
      .map((x) => `${x.name}: ${x.value}`)
      .join("\n");
    rows.push([
      String(p.id),
      p.sku ?? "",
      p.supplierCode ?? "",
      (p.categorySdId && pathOf.get(p.categorySdId)) || p.categoryName || "",
      p.nameTranslate ?? "",
      p.name,
      p.manufacturer ?? "",
      params,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  }
  return { rows, count: ps.length };
}
