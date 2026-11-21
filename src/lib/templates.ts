import type { Product } from "@prisma/client";
import { db } from "./db";
import { parseParams, type ProductParam } from "./salesdrive";

export type TemplateData = {
  id: number;
  name: string;
  categoryName: string | null;
  description: string | null;
  descriptionTranslate: string | null;
  keywords: string | null;
  keywordsUa: string | null;
  country: string | null;
  params: ProductParam[];
  manufacturer: string | null;
  supplierName: string | null;
};

/** Підстановки в шаблоні: {name} {sku} {barcode} {manufacturer} {category} {supplier} */
export function renderTemplate(text: string, p: { name?: string | null; sku?: string | null; barcode?: string | null; manufacturer?: string | null; categoryName?: string | null; supplierName?: string | null }) {
  return text
    .replaceAll("{name}", p.name ?? "")
    .replaceAll("{sku}", p.sku ?? "")
    .replaceAll("{barcode}", p.barcode ?? "")
    .replaceAll("{manufacturer}", p.manufacturer ?? "")
    .replaceAll("{category}", p.categoryName ?? "")
    .replaceAll("{supplier}", p.supplierName ?? "");
}

export async function listTemplates(): Promise<TemplateData[]> {
  const rows = await db.productTemplate.findMany({ orderBy: [{ categoryName: "asc" }] });
  return rows.map((t) => ({ ...t, params: parseParams(t.params) }));
}

/** Шаблон для категорії; якщо для категорії немає — загальний (без категорії) */
export async function templateFor(categoryName: string | null | undefined) {
  const all = await listTemplates();
  return all.find((t) => t.categoryName && categoryName && t.categoryName.toLowerCase() === categoryName.toLowerCase()) ?? all.find((t) => !t.categoryName) ?? null;
}

/**
 * Заповнити порожні поля нового товару з шаблону: опис, характеристики, виробник, постачальник.
 * Те, що вже заповнено вручну, не чіпаємо.
 */
export async function applyTemplate(productId: number) {
  // Шаблони описів прибрано (описи в кожного товару свої). Лише значення за замовчуванням:
  // характеристика «Стан: Новий» і країна «Китай», якщо не вказано інше.
  const p = await db.product.findUniqueOrThrow({ where: { id: productId } });
  const data: Partial<Product> = {};
  const params = parseParams(p.params);
  // характеристики за замовчуванням (змінюються вручну в товарі)
  for (const [name, value] of [
    ["Стан", "Новий"],
    ["Тип запчастини", "Оригінал"],
  ]) {
    if (!params.some((x) => x.name.trim().toLowerCase() === name.toLowerCase())) {
      params.push({ name, type: "text", value });
      data.params = JSON.stringify(params);
    }
  }
  if (!p.country) data.country = "Китай";
  if (!Object.keys(data).length) return p;
  return db.product.update({ where: { id: productId }, data });
}

/** Усе, що потрібно формі товару: постачальники, шаблони, категорії, валюти */
export async function productFormContext() {
  const [suppliers, templates, cats, currencies] = await Promise.all([
    db.supplier.findMany({ orderBy: { name: "asc" } }),
    listTemplates(),
    db.product.findMany({ where: { categoryName: { not: null }, deletedAt: null }, distinct: ["categoryName"], select: { categoryName: true } }),
    db.currency.findMany(),
  ]);
  const ymlCats = await ymlCategoryNames();
  const categories = [
    ...new Set([...cats.map((c) => c.categoryName!), ...templates.map((t) => t.categoryName).filter((x): x is string => Boolean(x)), ...ymlCats]),
  ].sort();
  return {
    suppliers,
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      categoryName: t.categoryName,
      description: t.description,
      descriptionTranslate: t.descriptionTranslate,
      keywords: t.keywords,
      keywordsUa: t.keywordsUa,
      country: t.country,
      params: t.params,
    })),
    categories,
    currencies: currencies.map((c) => c.code),
    showCurrency: process.env.ENABLE_CURRENCY === "true",
  };
}

export async function listCategories() {
  const [cats, tpls] = await Promise.all([
    db.product.findMany({ where: { categoryName: { not: null }, deletedAt: null }, distinct: ["categoryName"], select: { categoryName: true } }),
    db.productTemplate.findMany({ where: { categoryName: { not: null } }, select: { categoryName: true } }),
  ]);
  return [...new Set([...[...cats, ...tpls].map((c) => c.categoryName!), ...(await ymlCategoryNames())])].sort();
}

/** Категорії з YML SalesDrive (зберігаються під час синхронізації) — щоб нові порожні категорії теж були у списку */
async function ymlCategoryNames(): Promise<string[]> {
  try {
    const { getSetting } = await import("./util");
    const yml = JSON.parse((await getSetting("ymlCategories")) ?? "[]") as string[];
    const custom = JSON.parse((await getSetting("customCategories")) ?? "[]") as string[];
    const { parseCustomLine } = await import("./categories");
    return [...yml, ...custom.map((l) => parseCustomLine(l).name)];
  } catch {
    return [];
  }
}
