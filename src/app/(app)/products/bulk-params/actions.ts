"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { isSalesDriveConfigured, parseParams, productToSd, sdUpdateProducts } from "@/lib/salesdrive";
import { getSetting, logAction } from "@/lib/util";

/**
 * Масово: характеристика «Назва = Значення» для багатьох товарів (усім, категорії, лише де немає).
 * Іде в SalesDrive повним списком характеристик товару → з YML на Prom і Horoshop.
 */
export async function applyBulkParam(formData: FormData) {
  const user = await requirePerm("products.edit");
  const name = String(formData.get("name") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();
  const category = String(formData.get("category") ?? "");
  const mode = formData.get("mode") === "replace" ? "replace" : "missing";
  const back = (q: string) => redirect(`/products/bulk-params?${q}`);
  if (!name || !value) back(`err=${encodeURIComponent("Вкажіть назву і значення характеристики")}`);
  // без характеристик з YML ми не знаємо поточних — відправка повним списком стерла б їх у SalesDrive
  if ((await getSetting("ymlHasDetails")) !== "1")
    back(`err=${encodeURIComponent("YML SalesDrive не віддає описи й характеристики — увімкніть їх у вивантаженні, інакше можна стерти наявні")}`);

  const products = await db.product.findMany({
    where: { deletedAt: null, sdId: { not: null }, ...(category ? { categoryName: category } : {}) },
  });
  const changed: number[] = [];
  for (const p of products) {
    const params = parseParams(p.params);
    const ex = params.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    if (ex && (mode === "missing" ? ex.value.trim() !== "" : ex.value === value)) continue;
    if (ex) ex.value = value;
    else params.push({ name, type: "text", value });
    await db.product.update({ where: { id: p.id }, data: { params: JSON.stringify(params) } });
    changed.push(p.id);
  }
  let warn = "";
  if (changed.length && isSalesDriveConfigured()) {
    const full = await db.product.findMany({ where: { id: { in: changed } } });
    try {
      for (let i = 0; i < full.length; i += 100) await sdUpdateProducts(full.slice(i, i + 100).map((p) => productToSd(p, null, { withDetails: true, paramsMode: "replace" })));
      await db.product.updateMany({ where: { id: { in: changed } }, data: { syncError: null, syncedAt: new Date() } });
    } catch (e) {
      warn = e instanceof Error ? e.message : String(e);
      await db.product.updateMany({ where: { id: { in: changed } }, data: { syncError: warn } });
    }
  }
  await logAction(user.id, "bulk-param", "product", null, { name, value, category, mode, changed: changed.length });
  revalidatePath("/products");
  back(`msg=${encodeURIComponent(`«${name}: ${value}» — оновлено товарів: ${changed.length}${changed.length ? " (відправлено в SalesDrive)" : ""}`)}${warn ? `&warn=${encodeURIComponent(`SalesDrive: ${warn}`)}` : ""}`);
}
