"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { isSalesDriveConfigured, parseParams, productToSd, sdUpdateProducts } from "@/lib/salesdrive";
import { applyTemplate } from "@/lib/templates";
import { getSetting, logAction, str } from "@/lib/util";

const back = (msg: string) => {
  revalidatePath("/products/templates");
  redirect(`/products/templates?msg=${encodeURIComponent(msg)}`);
};

export async function saveTemplate(formData: FormData) {
  const user = await requirePerm("products.edit");
  const id = Number(formData.get("id")) || null;
  const data = {
    name: str(formData.get("name")) ?? "Шаблон",
    categoryName: str(formData.get("categoryName")),
    description: str(formData.get("description")),
    params: JSON.stringify(parseParams(String(formData.get("params") ?? "[]")).filter((p) => p.name.trim())),
    manufacturer: str(formData.get("manufacturer")),
    supplierName: str(formData.get("supplierName")),
  };
  try {
    const t = id ? await db.productTemplate.update({ where: { id }, data }) : await db.productTemplate.create({ data });
    await logAction(user.id, id ? "update" : "create", "template", t.id, { name: data.name, category: data.categoryName });
  } catch {
    return back(`Помилка: шаблон для категорії «${data.categoryName ?? "усі"}» уже існує`);
  }
  back("Шаблон збережено");
}

export async function deleteTemplate(formData: FormData) {
  const user = await requirePerm("products.edit");
  const id = Number(formData.get("id"));
  await db.productTemplate.delete({ where: { id } });
  await logAction(user.id, "delete", "template", id);
  back("Шаблон видалено");
}

/**
 * Застосувати шаблон до наявних товарів категорії, у яких порожні опис або характеристики,
 * і відправити зміни в SalesDrive. Лише коли YML віддає опис/характеристики (інакше не знаємо, що там уже є).
 */
export async function applyToExisting(formData: FormData) {
  const user = await requirePerm("products.edit");
  const t = await db.productTemplate.findUniqueOrThrow({ where: { id: Number(formData.get("id")) } });
  if ((await getSetting("ymlHasDetails")) !== "1")
    return back("Помилка: спершу увімкніть у YML-експорті «Експортувати опис, фото та характеристики» і синхронізуйтесь");
  const products = await db.product.findMany({
    where: {
      deletedAt: null,
      ...(t.categoryName ? { categoryName: t.categoryName } : {}),
      OR: [{ description: null }, { description: "" }, { params: null }, { params: "[]" }],
    },
    select: { id: true },
  });
  const changed: number[] = [];
  for (const p of products) {
    const before = await db.product.findUniqueOrThrow({ where: { id: p.id }, select: { description: true, params: true } });
    const after = await applyTemplate(p.id);
    if (after.description !== before.description || after.params !== before.params) changed.push(p.id);
  }
  let err = "";
  if (changed.length && isSalesDriveConfigured()) {
    const full = await db.product.findMany({ where: { id: { in: changed } } });
    try {
      await sdUpdateProducts(full.filter((p) => p.sdId).map((p) => productToSd(p, null, { withDetails: true, paramsMode: "replace" })));
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
  }
  await logAction(user.id, "apply-template", "template", t.id, { count: changed.length, err });
  back(err ? `Помилка відправки в SalesDrive: ${err}` : `Заповнено товарів: ${changed.length}`);
}
