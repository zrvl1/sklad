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
      // бренд і країна — ті самі в картках-комплектах (на Prom це окремі товари)
      const kitData = {
        ...(data.manufacturer !== undefined ? { manufacturer: data.manufacturer } : {}),
        ...(data.country !== undefined ? { country: data.country } : {}),
      };
      if (Object.keys(kitData).length) {
        const kits = await db.product.findMany({ where: { baseProductId: p.id, deletedAt: null }, select: { id: true, sdId: true } });
        if (kits.length) {
          await db.product.updateMany({ where: { id: { in: kits.map((k) => k.id) } }, data: kitData });
          toSd.push(...kits.filter((k) => k.sdId).map((k) => k.id));
        }
      }
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

/**
 * У SalesDrive у багатьох товарів у російському описі/назві лежить український текст.
 * Перекладаємо українську версію (DeepL, UA→RU, з HTML) у російське поле і відправляємо в SalesDrive.
 * Порціями, щоб не впертися в ліміт часу: натискати, доки не залишиться 0.
 */
export async function translateRuFromUa() {
  const user = await requirePerm("products.edit");
  const { translate, translateConfigured } = await import("@/lib/translate");
  const { foreignWords } = await import("@/lib/langcheck");
  if (!translateConfigured()) redirect(`/products/fill?f=lang&msg=${encodeURIComponent("Немає DEEPL_API_KEY у Vercel")}`);
  const all = await db.product.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, nameTranslate: true, description: true, descriptionTranslate: true },
  });
  const badDesc = (p: (typeof all)[number]) =>
    Boolean(p.descriptionTranslate?.trim()) && (!p.description?.trim() || foreignWords(p.description, "ru").length > 0);
  const badName = (p: (typeof all)[number]) => Boolean(p.nameTranslate?.trim()) && foreignWords(p.name, "ru").length > 0;
  const todo = all.filter((p) => badDesc(p) || badName(p));
  const batch = todo.slice(0, 100);
  let done = 0;
  const errors: string[] = [];
  for (let i = 0; i < batch.length; i += 25) {
    const chunk = batch.slice(i, i + 25);
    try {
      const descs = await translate(chunk.map((p) => (badDesc(p) ? (p.descriptionTranslate as string) : "")), "UK", "RU", true);
      const names = await translate(chunk.map((p) => (badName(p) ? (p.nameTranslate as string) : "")), "UK", "RU");
      for (const [k, p] of chunk.entries()) {
        const data: { description?: string; name?: string } = {};
        if (badDesc(p) && descs[k]?.trim()) data.description = descs[k];
        if (badName(p) && names[k]?.trim()) data.name = names[k].trim();
        if (!Object.keys(data).length) continue;
        await db.product.update({ where: { id: p.id }, data: { ...data, textEditedAt: new Date() } });
        done++;
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      break;
    }
  }
  // у SalesDrive
  let sdErr = "";
  const ids = batch.map((p) => p.id);
  if (done && isSalesDriveConfigured()) {
    const full = await db.product.findMany({ where: { id: { in: ids }, sdId: { not: null } } });
    try {
      await sdUpdateProducts(full.map((p) => productToSd(p, null, {})));
      await db.product.updateMany({ where: { id: { in: full.map((p) => p.id) } }, data: { syncError: null, syncedAt: new Date() } });
    } catch (e) {
      sdErr = e instanceof Error ? e.message : String(e);
      await db.product.updateMany({ where: { id: { in: full.map((p) => p.id) } }, data: { syncError: sdErr } });
    }
  }
  const left = Math.max(0, todo.length - done);
  const msg = `Перекладено UA→RU: ${done}. Залишилось: ${left}${left ? " — натисніть ще раз" : ""}${errors.length ? `. Помилка DeepL: ${errors[0].slice(0, 200)}` : ""}${sdErr ? `. SalesDrive: ${sdErr.slice(0, 200)}` : ""}`;
  await logAction(user.id, "translate-ru", "product", null, msg);
  revalidatePath("/products/fill");
  redirect(`/products/fill?f=lang&msg=${encodeURIComponent(msg)}`);
}
