"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAction } from "@/lib/util";

const back = (msg: string) => {
  revalidatePath("/settings/prom-commission");
  redirect(`/settings/prom-commission?msg=${encodeURIComponent(msg)}`);
};

export async function saveRates(formData: FormData) {
  const user = await requirePerm("settings");
  const rates: Record<string, number> = {};
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("r_")) continue;
    const n = Number(String(v).replace(",", "."));
    if (String(v).trim() && Number.isFinite(n) && n > 0 && n < 100) rates[k.slice(2)] = n;
  }
  await db.setting.upsert({ where: { key: "promCommissionRates" }, update: { value: JSON.stringify(rates) }, create: { key: "promCommissionRates", value: JSON.stringify(rates) } });
  await logAction(user.id, "update", "promCommissionRates", null, rates);
  back(`Збережено ставок: ${Object.keys(rates).length}`);
}

export async function reloadPromCats() {
  await requirePerm("settings");
  const { promConfigured, refreshPromMap } = await import("@/lib/prom");
  if (!promConfigured()) return back("Prom API не налаштовано");
  let msg: string;
  try {
    const n = await refreshPromMap();
    msg = `Завантажено товарів з Prom: ${n}`;
  } catch (e) {
    msg = `Помилка: ${e instanceof Error ? e.message : e}`;
  }
  back(msg);
}
