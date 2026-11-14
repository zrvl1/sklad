"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { fetchStatuses, syncOrders } from "@/lib/orders";
import { logAction, setSetting } from "@/lib/util";

export async function refreshPicking() {
  const user = await requireUser();
  let msg = "Заявки оновлено";
  try {
    await fetchStatuses();
    const r = await syncOrders();
    await logAction(user.id, "sync-orders", "orders", null, r);
  } catch (e) {
    msg = `Помилка: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/picking");
  redirect(`/picking?msg=${encodeURIComponent(msg)}`);
}

/** Статуси заявок, які треба збирати (напр. «Нове», «Підтверджено») */
export async function savePickStatuses(formData: FormData) {
  const user = await requireAdmin();
  const ids = formData.getAll("status").map(Number).filter(Boolean);
  await setSetting("pickStatuses", JSON.stringify(ids));
  await logAction(user.id, "pick-statuses", "settings", null, ids);
  redirect(`/picking?msg=${encodeURIComponent("Статуси для збирання збережено")}`);
}
