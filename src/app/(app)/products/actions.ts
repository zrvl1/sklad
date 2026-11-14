"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { internalEan13 } from "@/lib/barcode";
import { isSalesDriveConfigured, productToSd, sdUpdateProducts } from "@/lib/salesdrive";
import { buildSearch, logAction, num, str } from "@/lib/util";

/** Відправити товар у SalesDrive і записати результат (помилку) у товар */
export async function pushProduct(productId: number, withName: boolean) {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId } });
  if (!isSalesDriveConfigured()) return { ok: false, error: "SalesDrive не налаштовано в .env" };
  try {
    await sdUpdateProducts([productToSd(p, null, { withName })]);
    await db.product.update({ where: { id: p.id }, data: { syncError: null, syncedAt: new Date() } });
    return { ok: true as const };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.product.update({ where: { id: p.id }, data: { syncError: error } });
    return { ok: false as const, error };
  }
}

/** Призначаємо ID для SalesDrive та штрихкод, якщо їх немає */
async function finalizeNewProduct(id: number, genBarcode: boolean) {
  const p = await db.product.findUniqueOrThrow({ where: { id } });
  const sdId = p.sdId ?? `W${String(id).padStart(6, "0")}`;
  const barcode = p.barcode ?? (genBarcode ? internalEan13(id) : null);
  return db.product.update({
    where: { id },
    data: { sdId, barcode, search: buildSearch({ name: p.name, sku: p.sku, barcode, sdId }) },
  });
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
    cost: num(formData.get("cost")),
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
  const search = buildSearch(data);

  let productId: number;
  let withName = true;
  if (id) {
    const before = await db.product.findUniqueOrThrow({ where: { id }, select: { name: true } });
    withName = before.name !== data.name; // назву шлемо лише якщо її змінили
    await db.product.update({ where: { id }, data: { ...data, search } });
    productId = id;
    if (formData.get("genBarcode") && !data.barcode) await finalizeNewProduct(id, true);
    await logAction(user.id, "update", "product", id, data);
  } else {
    const created = await db.product.create({ data: { ...data, search } });
    await finalizeNewProduct(created.id, Boolean(formData.get("genBarcode")));
    productId = created.id;
    await logAction(user.id, "create", "product", created.id, data);
  }

  const res = await pushProduct(productId, withName);
  revalidatePath("/products");
  redirect(`/products/${productId}?saved=${res.ok ? 1 : 0}`);
}

/** Швидке створення товару прямо з документа приходу */
export async function createProductQuick(input: { name: string; price: number; cost: number; barcode?: string; sku?: string; genBarcode?: boolean }) {
  const user = await requireUser();
  if (!input.name.trim()) return { ok: false as const, error: "Вкажіть назву" };
  const data = {
    name: input.name.trim(),
    price: input.price || 0,
    cost: input.cost || 0,
    barcode: input.barcode?.trim() || null,
    sku: input.sku?.trim() || null,
  };
  const created = await db.product.create({ data: { ...data, search: buildSearch(data) } });
  const p = await finalizeNewProduct(created.id, input.genBarcode ?? true);
  await logAction(user.id, "create", "product", p.id, { ...data, from: "receipt" });
  const push = await pushProduct(p.id, true);
  return {
    ok: true as const,
    warning: push.ok ? null : `Товар збережено, але не відправлено в SalesDrive: ${push.error}`,
    product: { id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, price: p.price, cost: p.cost },
  };
}

export async function retryPush(formData: FormData) {
  await requireUser();
  const id = Number(formData.get("id"));
  const p = await db.product.findUniqueOrThrow({ where: { id }, select: { sdId: true } });
  // повтор для товару, створеного в нашому додатку (ID на W…), — з назвою; для товарів із CRM — без
  const res = await pushProduct(id, Boolean(p.sdId?.startsWith("W")));
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}?saved=${res.ok ? 1 : 0}`);
}

export async function addProductCell(formData: FormData) {
  const user = await requireUser();
  const productId = Number(formData.get("productId"));
  const cellId = Number(formData.get("cellId"));
  const qty = num(formData.get("qty"));
  if (!cellId) return;
  await db.productCell.upsert({
    where: { productId_cellId: { productId, cellId } },
    update: { qty },
    create: { productId, cellId, qty },
  });
  await logAction(user.id, "assign-cell", "product", productId, { cellId, qty });
  revalidatePath(`/products/${productId}`);
}

export async function removeProductCell(formData: FormData) {
  const user = await requireUser();
  const productId = Number(formData.get("productId"));
  const cellId = Number(formData.get("cellId"));
  await db.productCell.delete({ where: { productId_cellId: { productId, cellId } } });
  await logAction(user.id, "remove-cell", "product", productId, { cellId });
  revalidatePath(`/products/${productId}`);
}
