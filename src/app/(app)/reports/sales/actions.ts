"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { fetchStatuses, syncOrders } from "@/lib/orders";
import { logAction, setSetting } from "@/lib/util";

export async function refreshSales() {
  const user = await requirePerm("reports");
  let msg: string;
  try {
    await fetchStatuses();
    const r = await syncOrders();
    await logAction(user.id, "sync-orders", "orders", null, r);
    msg = `Оновлено заявок: ${r.saved}`;
  } catch (e) {
    msg = `Помилка: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/reports/sales");
  redirect(`/reports/sales?msg=${encodeURIComponent(msg)}`);
}

/** Які статуси заявок вважати продажем (напр. «Виконано», «Відправлено») */
export async function saveSaleStatuses(formData: FormData) {
  const user = await requirePerm("settings");
  const ids = formData.getAll("status").map(Number).filter(Boolean);
  await setSetting("saleStatuses", JSON.stringify(ids));
  await logAction(user.id, "sale-statuses", "settings", null, ids);
  revalidatePath("/reports/sales");
  redirect(`/reports/sales?msg=${encodeURIComponent("Статуси збережено")}`);
}

/**
 * Перезавантажити заявки за рік — щоб у старих заявок з'явились сайт, UTM-мітки, комісія, дата продажу.
 * Довге (кілька хвилин на ~4000 заявок); якщо обірветься — натиснути ще раз, продовжить звичайне оновлення.
 */
export async function resyncOrdersYear() {
  const user = await requirePerm("settings");
  let msg: string;
  try {
    const { db } = await import("@/lib/db");
    await db.setting.deleteMany({ where: { key: "lastOrderSync" } });
    const r = await syncOrders(400);
    await logAction(user.id, "resync-orders", "orders", null, r);
    msg = `Перезавантажено заявок: ${r.saved}`;
  } catch (e) {
    msg = `Помилка: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/reports/sales");
  revalidatePath("/reports/channels");
  redirect(`/reports/channels?msg=${encodeURIComponent(msg)}`);
}
