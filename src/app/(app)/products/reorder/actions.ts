"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { logAction, setSetting } from "@/lib/util";
import { reorderRows } from "@/lib/demand";

/** Зберегти мінімальні залишки з таблиці (поле min_<id>; порожнє — підказка додатку) */
async function saveMinsFrom(formData: FormData) {
  let changed = 0;
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("min_")) continue;
    const id = Number(k.slice(4));
    const raw = String(v).trim().replace(",", ".");
    const val = raw === "" ? null : Number(raw);
    if (val !== null && (!Number.isFinite(val) || val < 0)) continue;
    const prev = formData.get(`prev_${id}`);
    const prevVal = prev === null || prev === "" ? null : Number(prev);
    if (prevVal === val) continue;
    await db.product.update({ where: { id }, data: { minStock: val } });
    changed++;
  }
  return changed;
}

export async function saveMins(formData: FormData) {
  const user = await requirePerm("products.edit");
  const changed = await saveMinsFrom(formData);
  await logAction(user.id, "min-stock", "product", null, `змінено ${changed}`);
  revalidatePath("/products/reorder");
  redirect(`/products/reorder?${new URLSearchParams({ f: String(formData.get("f") ?? ""), msg: `Мінімальні залишки збережено: ${changed}` })}`);
}

export async function saveReorderSettings(formData: FormData) {
  await requirePerm("products.edit");
  const lead = Math.max(1, Math.min(180, Number(formData.get("lead")) || 14));
  const cover = Math.max(0, Math.min(365, Number(formData.get("cover")) || 30));
  await setSetting("reorderLeadDays", String(lead));
  await setSetting("reorderCoverDays", String(cover));
  revalidatePath("/products/reorder");
  redirect(`/products/reorder?msg=${encodeURIComponent(`Поставка ${lead} дн., закуповуємо на ${cover} дн.`)}`);
}

/** Чернетка приходу на постачальника: товари нижче мінімуму, кількість «дозамовити», ціна — поточна собівартість */
export async function draftReceiptForSupplier(formData: FormData) {
  const user = await requirePerm("receipts");
  await saveMinsFrom(formData);
  const supplierName = String(formData.get("supplier") ?? "");
  const { rows } = await reorderRows();
  const lines = rows.filter((r) => r.below && r.toOrder > 0 && (r.supplierName ?? "") === supplierName);
  if (!lines.length) redirect(`/products/reorder?msg=${encodeURIComponent("Немає що дозамовляти в цього постачальника")}`);
  const wh = (await db.warehouse.findFirst({ where: { isDefault: true } })) ?? (await db.warehouse.findFirst());
  if (!wh) throw new Error("Спочатку створіть склад у Налаштуваннях");
  const supplier = supplierName ? await db.supplier.findUnique({ where: { name: supplierName } }) : null;
  const r = await db.receipt.create({
    data: {
      number: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      warehouseId: wh.id,
      createdById: user.id,
      supplierId: supplier?.id ?? null,
      note: "Чернетка з «Що дозамовити» — уточніть кількість і ціни перед проведенням",
      lines: { create: lines.map((l) => ({ productId: l.id, qty: l.toOrder, cost: l.cost })) },
    },
  });
  await db.receipt.update({ where: { id: r.id }, data: { number: `П-${String(r.id).padStart(6, "0")}` } });
  await logAction(user.id, "create", "receipt", r.id, `з «Що дозамовити»: ${supplierName || "без постачальника"}, позицій ${lines.length}`);
  redirect(`/receipts/${r.id}`);
}
