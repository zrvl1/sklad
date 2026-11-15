"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { findOrderByScan, orderForPacking } from "@/lib/picking";
import { ordersEnabled, syncOrders } from "@/lib/orders";
import { logAction } from "@/lib/util";

/** Скан ТТН (або номер заявки) → заявка з товарами для пакування */
export async function loadOrderByScan(code: string) {
  await requirePerm("packing");
  let id = await findOrderByScan(code);
  // ТТН щойно створили в CRM, а ми ще не синхронізувались — пробуємо оновити заявки й шукаємо ще раз
  if (!id && ordersEnabled()) {
    try {
      await syncOrders();
      id = await findOrderByScan(code);
    } catch {
      /* без зв'язку — покажемо, що не знайдено */
    }
  }
  if (!id) return { ok: false as const, error: `Заявку з ТТН / номером «${code}» не знайдено. Натисніть «Оновити з SalesDrive» на сторінці збирання.` };
  const order = await orderForPacking(id);
  if (!order) return { ok: false as const, error: "Заявку не знайдено" };
  return { ok: true as const, order };
}

/** Позначити заявку запакованою (лише в додатку) */
export async function markPacked(orderId: number, scanned: Record<string, number>, checked: boolean) {
  const user = await requirePerm("packing");
  await db.orderPack.upsert({
    where: { orderId },
    update: { packedAt: new Date(), packedBy: user.name, checked, scanned: JSON.stringify(scanned) },
    create: { orderId, packedBy: user.name, checked, scanned: JSON.stringify(scanned) },
  });
  await logAction(user.id, checked ? "pack" : "pack-unchecked", "order", orderId, scanned);
  revalidatePath("/picking");
  return { ok: true as const };
}

/** Скасувати позначку «запаковано» (напр. перепакувати) */
export async function unpack(formData: FormData) {
  const user = await requirePerm("packing");
  const orderId = Number(formData.get("orderId"));
  await db.orderPack.deleteMany({ where: { orderId } });
  await logAction(user.id, "unpack", "order", orderId);
  revalidatePath("/picking");
}

/** Що за код відскановано під час пакування (його немає серед товарів поточної заявки): інша ТТН чи чужий товар */
export async function identifyCode(code: string) {
  await requirePerm("packing");
  const orderId = await findOrderByScan(code);
  if (orderId) return { kind: "order" as const, orderId };
  const { findByCode } = await import("@/lib/codes");
  const [p] = await findByCode(code);
  if (p) return { kind: "product" as const, name: p.name, sku: p.sku };
  return { kind: "unknown" as const };
}
