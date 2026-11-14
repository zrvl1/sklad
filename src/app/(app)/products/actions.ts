"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";
import { internalEan13 } from "@/lib/barcode";
import { addCode, codeOwner, refreshSearch } from "@/lib/codes";
import { isSalesDriveConfigured, productToSd, sdUpdateProducts } from "@/lib/salesdrive";
import { setCellQty } from "@/lib/stock";
import { buildSearch, getSetting, logAction, num, str } from "@/lib/util";
import { getRates, toUah } from "@/lib/currency";

type PushOpts = { withName?: boolean; withPrice?: boolean; withCost?: boolean };
const ALL: PushOpts = { withName: true, withPrice: true, withCost: true };

/** Відправити товар у SalesDrive і записати результат (помилку) у товар */
export async function pushProduct(productId: number, opts: PushOpts) {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId } });
  if (!isSalesDriveConfigured()) return { ok: false, error: "SalesDrive не налаштовано в .env" };
  try {
    await sdUpdateProducts([productToSd(p, null, opts)]);
    await db.product.update({ where: { id: p.id }, data: { syncError: null, syncedAt: new Date() } });
    return { ok: true as const };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.product.update({ where: { id: p.id }, data: { syncError: error } });
    return { ok: false as const, error };
  }
}

/** Наступний вільний артикул за префіксом із Налаштувань, напр. CM0471 */
async function nextSku() {
  const prefix = (await getSetting("skuPrefix")) ?? "ART";
  const digits = Number(await getSetting("skuDigits")) || 4;
  const rows = await db.product.findMany({ where: { sku: { startsWith: prefix } }, select: { sku: true } });
  let max = 0;
  for (const r of rows) {
    const n = Number(r.sku!.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  for (let n = max + 1; ; n++) {
    const sku = prefix + String(n).padStart(digits, "0");
    if (!(await codeOwner(sku))) return sku;
  }
}

/** Призначаємо ID для SalesDrive, штрихкод і артикул, якщо їх немає */
async function finalizeNewProduct(id: number, opts: { genBarcode: boolean; genSku?: boolean }) {
  const p = await db.product.findUniqueOrThrow({ where: { id } });
  const sdId = p.sdId ?? `W${String(id).padStart(6, "0")}`;
  let barcode = p.barcode;
  if (!barcode && opts.genBarcode) {
    barcode = internalEan13(id);
    if (await codeOwner(barcode, id)) barcode = internalEan13(id + 500000000); // вкрай рідкісний збіг — інший діапазон
  }
  const sku = p.sku ?? (opts.genSku ? await nextSku() : null);
  await db.product.update({ where: { id }, data: { sdId, barcode, sku } });
  await refreshSearch(id);
  return db.product.findUniqueOrThrow({ where: { id } });
}

/** Попередження, якщо штрихкод чи артикул уже є в іншого товару */
async function duplicateWarning(productId: number, barcode: string | null, sku: string | null) {
  const msgs: string[] = [];
  for (const [label, code] of [["Штрихкод", barcode], ["Артикул", sku]] as const) {
    if (!code) continue;
    const other = await codeOwner(code, productId);
    if (other) msgs.push(`${label} ${code} також є в товару «${other.name}»`);
  }
  return msgs.join("; ");
}

export async function saveProduct(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id")) || null;
  const name = str(formData.get("name"));
  if (!name) throw new Error("Вкажіть назву товару");

  const data = {
    name,
    nameForDocuments: str(formData.get("nameForDocuments")),
    categoryName: str(formData.get("categoryName")),
    price: num(formData.get("price")),
    discountValue: num(formData.get("discountValue")) || null,
    discountType: str(formData.get("discountType")) ?? "percent",
    discountFrom: str(formData.get("discountFrom")) ? new Date(String(formData.get("discountFrom"))) : null,
    discountTo: str(formData.get("discountTo")) ? new Date(String(formData.get("discountTo"))) : null,
    sku: str(formData.get("sku")),
    barcode: str(formData.get("barcode")),
    manufacturer: str(formData.get("manufacturer")),
    supplierName: str(formData.get("supplierName")),
    sdId: str(formData.get("sdId")),
  };
  // Собівартість: у гривні або у валюті закупівлі (тоді в гривні рахуємо за курсом SalesDrive)
  const costInput = num(formData.get("cost"));
  const costCurrency = str(formData.get("costCurrency")) ?? "UAH";
  const costData =
    costCurrency === "UAH"
      ? { cost: costInput, costCurrency: null, costOriginal: null }
      : { cost: toUah(costInput, costCurrency, await getRates()), costCurrency, costOriginal: costInput };
  const gen = { genBarcode: Boolean(formData.get("genBarcode")), genSku: Boolean(formData.get("genSku")) };

  let productId: number;
  let opts: PushOpts = ALL;
  if (id) {
    const before = await db.product.findUniqueOrThrow({ where: { id } });
    // відправляємо лише те, що змінилося (назва, ціна, собівартість)
    opts = {
      withName: before.name !== data.name,
      withPrice: before.price !== data.price,
      withCost: before.cost !== costData.cost || (before.costCurrency ?? null) !== costData.costCurrency || (before.costOriginal ?? null) !== costData.costOriginal,
    };
    await db.product.update({ where: { id }, data: { ...data, ...costData, search: buildSearch(data) } });
    productId = id;
    await finalizeNewProduct(id, gen);
    await logAction(user.id, "update", "product", id, data);
  } else {
    const created = await db.product.create({ data: { ...data, ...costData, search: buildSearch(data) } });
    await finalizeNewProduct(created.id, gen);
    productId = created.id;
    await logAction(user.id, "create", "product", created.id, data);
  }

  // Артикул постачальника з форми (необов'язково)
  const supplierCode = str(formData.get("supplierCode"));
  let warn = "";
  if (supplierCode) {
    try {
      await addCode(productId, supplierCode, "supplier", Number(formData.get("supplierCodeSupplierId")) || null);
    } catch (e) {
      warn = e instanceof Error ? e.message : String(e);
    }
  }
  const saved = await db.product.findUniqueOrThrow({ where: { id: productId } });
  warn = [warn, await duplicateWarning(productId, saved.barcode, saved.sku)].filter(Boolean).join("; ");

  const res = await pushProduct(productId, opts);
  revalidatePath("/products");
  redirect(`/products/${productId}?saved=${res.ok ? 1 : 0}${warn ? `&warn=${encodeURIComponent(warn)}` : ""}`);
}

/** Швидке створення товару прямо з документа приходу або інвентаризації */
export async function createProductQuick(input: {
  name: string;
  price: number;
  cost: number;
  costCurrency?: string; // валюта закупівлі (з документа приходу)
  barcode?: string;
  supplierCode?: string;
  supplierId?: number | null;
  genBarcode?: boolean;
  genSku?: boolean;
}) {
  const user = await requireUser();
  if (!input.name.trim()) return { ok: false as const, error: "Вкажіть назву" };
  const barcode = input.barcode?.trim() || null;
  if (barcode) {
    const other = await codeOwner(barcode);
    if (other) return { ok: false as const, error: `Код ${barcode} вже є в товару «${other.name}»` };
  }
  const cur = input.costCurrency && input.costCurrency !== "UAH" ? input.costCurrency : null;
  const costData = cur
    ? { cost: toUah(input.cost || 0, cur, await getRates()), costCurrency: cur, costOriginal: input.cost || 0 }
    : { cost: input.cost || 0, costCurrency: null, costOriginal: null };
  const data = { name: input.name.trim(), price: input.price || 0, barcode };
  const created = await db.product.create({ data: { ...data, ...costData, search: buildSearch(data) } });
  await finalizeNewProduct(created.id, { genBarcode: input.genBarcode ?? true, genSku: input.genSku ?? true });
  let warning: string | null = null;
  if (input.supplierCode?.trim()) {
    try {
      await addCode(created.id, input.supplierCode, "supplier", input.supplierId ?? null);
    } catch (e) {
      warning = e instanceof Error ? e.message : String(e);
    }
  }
  const p = await db.product.findUniqueOrThrow({ where: { id: created.id } });
  await logAction(user.id, "create", "product", p.id, { ...data, from: "document" });
  const push = await pushProduct(p.id, ALL);
  if (!push.ok) warning = `Товар збережено, але не відправлено в SalesDrive: ${push.error}`;
  return {
    ok: true as const,
    warning,
    product: { id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, price: p.price, cost: p.cost, sdId: p.sdId },
  };
}

/** Прив'язати відсканований невідомий код до існуючого товару (з приходу/інвентаризації) */
export async function linkCode(input: { productId: number; code: string; type: "supplier" | "barcode"; supplierId: number | null }) {
  const user = await requireUser();
  try {
    await addCode(input.productId, input.code, input.type, input.supplierId);
    await logAction(user.id, "add-code", "product", input.productId, input);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function addProductCode(formData: FormData) {
  const user = await requireUser();
  const productId = Number(formData.get("productId"));
  const code = String(formData.get("code") ?? "");
  const type = formData.get("type") === "barcode" ? "barcode" : "supplier";
  let msg = "";
  try {
    await addCode(productId, code, type, Number(formData.get("supplierId")) || null);
    await logAction(user.id, "add-code", "product", productId, { code, type });
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}${msg ? `?warn=${encodeURIComponent(msg)}` : ""}`);
}

export async function removeProductCode(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  const c = await db.productCode.delete({ where: { id } });
  await refreshSearch(c.productId);
  await logAction(user.id, "remove-code", "product", c.productId, { code: c.code });
  revalidatePath(`/products/${c.productId}`);
}

export async function retryPush(formData: FormData) {
  await requireUser();
  const id = Number(formData.get("id"));
  const p = await db.product.findUniqueOrThrow({ where: { id }, select: { sdId: true } });
  // повтор для товару, створеного в нашому додатку (ID на W…), — з назвою; для товарів із CRM — без
  const res = await pushProduct(id, p.sdId?.startsWith("W") ? ALL : {});
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}?saved=${res.ok ? 1 : 0}`);
}

export async function addProductCell(formData: FormData) {
  const user = await requireUser();
  const productId = Number(formData.get("productId"));
  const cellId = Number(formData.get("cellId"));
  if (!cellId) return;
  await setCellQty({ productId, cellId, qty: num(formData.get("qty")), userId: user.id });
  await logAction(user.id, "assign-cell", "product", productId, { cellId });
  revalidatePath(`/products/${productId}`);
}

export async function removeProductCell(formData: FormData) {
  const user = await requireUser();
  const productId = Number(formData.get("productId"));
  const cellId = Number(formData.get("cellId"));
  await setCellQty({ productId, cellId, qty: 0, userId: user.id });
  await db.productCell.delete({ where: { productId_cellId: { productId, cellId } } });
  await logAction(user.id, "remove-cell", "product", productId, { cellId });
  revalidatePath(`/products/${productId}`);
}

/**
 * Масово: згенерувати штрихкоди (EAN-13, префікс 200) і/або артикули всім товарам, де їх немає,
 * і відправити в SalesDrive пачками по 100. Лише для адміністратора.
 */
export async function bulkGenerate(formData: FormData) {
  const user = await requireAdmin();
  const what = String(formData.get("what")); // barcode | sku
  const products = await db.product.findMany({
    where: what === "sku" ? { OR: [{ sku: null }, { sku: "" }] } : { OR: [{ barcode: null }, { barcode: "" }] },
    select: { id: true },
  });
  for (const p of products) {
    if (what === "sku") await db.product.update({ where: { id: p.id }, data: { sku: null } });
    else await db.product.update({ where: { id: p.id }, data: { barcode: null } });
    await finalizeNewProduct(p.id, { genBarcode: what !== "sku", genSku: what === "sku" });
  }
  let error = "";
  if (products.length && isSalesDriveConfigured()) {
    const full = await db.product.findMany({ where: { id: { in: products.map((p) => p.id) } } });
    try {
      await sdUpdateProducts(full.filter((p) => p.sdId).map((p) => productToSd(p, null, {})));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      await db.product.updateMany({ where: { id: { in: products.map((p) => p.id) } }, data: { syncError: error } });
    }
  }
  await logAction(user.id, `bulk-${what}`, "products", null, { count: products.length, error });
  const label = what === "sku" ? "артикули" : "штрихкоди";
  redirect(
    `/products/codes?msg=${encodeURIComponent(error ? `Помилка відправки в SalesDrive: ${error}` : `Згенеровано ${label}: ${products.length}`)}`
  );
}

export async function saveSkuSettings(formData: FormData) {
  const user = await requireAdmin();
  const { setSetting } = await import("@/lib/util");
  const prefix = (str(formData.get("prefix")) ?? "ART").toUpperCase().replace(/[^A-ZА-ЯІЇЄҐ0-9-]/g, "");
  const digits = Math.min(8, Math.max(3, Number(formData.get("digits")) || 4));
  await setSetting("skuPrefix", prefix);
  await setSetting("skuDigits", String(digits));
  await logAction(user.id, "sku-settings", "settings", null, { prefix, digits });
  redirect(`/products/codes?msg=${encodeURIComponent(`Шаблон артикула: ${prefix}${"0".repeat(digits - 1)}1`)}`);
}
