"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { isSalesDriveConfigured, productToSd, sdUpdateProducts } from "@/lib/salesdrive";
import { setCellQty } from "@/lib/stock";
import { buildSearch, logAction, num } from "@/lib/util";

/**
 * Зберегти сторінку таблиці «Заповнення даних»: виробник, собівартість, комірка.
 * Змінені виробник/собівартість ідуть у SalesDrive (пачкою), комірки — лише в додатку.
 */
export async function saveFill(formData: FormData) {
  const user = await requirePerm("products.edit");
  const ids = formData.getAll("id").map(Number).filter(Boolean);
  const bulkMan = String(formData.get("bulkManufacturer") ?? "").trim();
  const bulkCountry = String(formData.get("bulkCountry") ?? "").trim();
  const back = String(formData.get("back") ?? "/products/fill");
  const products = await db.product.findMany({ where: { id: { in: ids } } });
  const toSd: number[] = [];
  let changed = 0;
  let cellsSet = 0;
  const errors: string[] = [];

  for (const p of products) {
    const selected = formData.get(`sel_${p.id}`) === "1";
    let man = String(formData.get(`m_${p.id}`) ?? "").trim();
    if (bulkMan && selected) man = bulkMan;
    const costRaw = String(formData.get(`c_${p.id}`) ?? "").trim();
    const cost = costRaw === "" ? p.cost : num(costRaw);
    let country = String(formData.get(`k_${p.id}`) ?? "").trim();
    if (bulkCountry && selected) country = bulkCountry;
    const data: { manufacturer?: string | null; country?: string | null; cost?: number; costCurrency?: null; costOriginal?: null } = {};
    if ((man || null) !== (p.manufacturer || null)) data.manufacturer = man || null;
    if ((country || null) !== (p.country || null)) data.country = country || null;
    if (cost >= 0 && Math.abs(cost - p.cost) > 0.001) {
      if (p.price > 0 && cost > p.price * 3) errors.push(`${p.sku ?? p.name}: собівартість ${cost} у 3+ рази більша за ціну — не збережено`);
      else Object.assign(data, { cost: Math.round(cost * 100) / 100, costCurrency: null, costOriginal: null });
    }
    if (Object.keys(data).length) {
      await db.product.update({ where: { id: p.id }, data: { ...data, search: buildSearch({ ...p, ...data }) } });
      changed++;
      if (p.sdId) toSd.push(p.id);
    }
    const cellId = Number(formData.get(`cell_${p.id}`)) || 0;
    if (cellId) {
      const qty = num(formData.get(`cq_${p.id}`));
      if (qty > 0) {
        await setCellQty({ productId: p.id, cellId, qty, userId: user.id });
        cellsSet++;
      }
    }
  }

  let warn = errors.join("; ");
  if (toSd.length && isSalesDriveConfigured()) {
    const full = await db.product.findMany({ where: { id: { in: toSd } } });
    try {
      for (let i = 0; i < full.length; i += 100) await sdUpdateProducts(full.slice(i, i + 100).map((p) => productToSd(p, null, { withCost: true })));
      await db.product.updateMany({ where: { id: { in: toSd } }, data: { syncError: null, syncedAt: new Date() } });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      await db.product.updateMany({ where: { id: { in: toSd } }, data: { syncError: m } });
      warn = `${warn ? `${warn}; ` : ""}SalesDrive: ${m}`;
    }
  }
  await logAction(user.id, "bulk-fill", "product", null, { changed, cellsSet });
  revalidatePath("/products");
  const sep = back.includes("?") ? "&" : "?";
  redirect(`${back}${sep}msg=${encodeURIComponent(`Збережено: товарів ${changed}, комірок ${cellsSet}${toSd.length ? " (у SalesDrive відправлено)" : ""}`)}${warn ? `&warn=${encodeURIComponent(warn)}` : ""}`);
}
