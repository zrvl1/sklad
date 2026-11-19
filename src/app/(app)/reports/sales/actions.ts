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
    const { backfillOrders, startBackfill } = await import("@/lib/orders");
    await startBackfill(400);
    const r = await backfillOrders();
    await logAction(user.id, "resync-orders", "orders", null, r);
    msg = r?.done
      ? `Перезавантажено заявок: ${r.saved}`
      : `Завантажено ${r?.saved ?? 0} заявок, решта довантажиться у фоні (≈ 8 сторінок по 100 заявок на хвилину через ліміт SalesDrive)`;
  } catch (e) {
    msg = `Помилка: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/reports/sales");
  revalidatePath("/reports/channels");
  redirect(`/reports/channels?msg=${encodeURIComponent(msg)}`);
}

/** Продовжити фонове завантаження вручну (одна порція) */
export async function continueBackfill() {
  await requirePerm("reports");
  const { backfillOrders } = await import("@/lib/orders");
  let msg: string;
  try {
    const r = await backfillOrders();
    msg = !r ? "Завантаження не активне" : r.done ? `Готово: завантажено ${r.saved} заявок` : `Завантажено ${r.saved} заявок, сторінка ${r.page} з ${r.pages}`;
  } catch (e) {
    msg = `Помилка: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/reports/channels");
  redirect(`/reports/channels?msg=${encodeURIComponent(msg)}`);
}

/** Назви сайтів (SalesDrive віддає їх номерами) */
export async function saveSiteNames(formData: FormData) {
  await requirePerm("reports");
  const map: Record<string, string> = {};
  for (const id of formData.getAll("siteId").map(String)) {
    const name = String(formData.get(`siteName_${id}`) ?? "").trim().slice(0, 60);
    if (name) map[id] = name;
  }
  await setSetting("siteNames", JSON.stringify(map));
  revalidatePath("/reports/channels");
  redirect(`/reports/channels?msg=${encodeURIComponent("Назви сайтів збережено")}`);
}
