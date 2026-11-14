"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { fetchStatuses, syncOrders } from "@/lib/orders";
import { logAction, setSetting } from "@/lib/util";

export async function refreshSales() {
  const user = await requireUser();
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
  const user = await requireAdmin();
  const ids = formData.getAll("status").map(Number).filter(Boolean);
  await setSetting("saleStatuses", JSON.stringify(ids));
  await logAction(user.id, "sale-statuses", "settings", null, ids);
  revalidatePath("/reports/sales");
  redirect(`/reports/sales?msg=${encodeURIComponent("Статуси збережено")}`);
}
