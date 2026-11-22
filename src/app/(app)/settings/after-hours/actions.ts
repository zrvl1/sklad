"use server";

import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { setSetting } from "@/lib/util";
import { DEFAULT_CFG, runAfterHours } from "@/lib/afterHours";

const t = (v: FormDataEntryValue | null, d: string) => (/^\d{1,2}:\d{2}$/.test(String(v ?? "")) ? String(v) : d);

export async function saveAfterHours(formData: FormData) {
  await requirePerm("settings");
  const cfg = {
    enabled: formData.get("enabled") === "on",
    fromStatusId: Number(formData.get("from")) || null,
    toStatusId: Number(formData.get("to")) || null,
    weekdayEnd: t(formData.get("weekdayEnd"), DEFAULT_CFG.weekdayEnd),
    weekendEnd: t(formData.get("weekendEnd"), DEFAULT_CFG.weekendEnd),
    start: t(formData.get("start"), DEFAULT_CFG.start),
  };
  if (cfg.fromStatusId && cfg.fromStatusId === cfg.toStatusId) redirect("/settings/after-hours?msg=" + encodeURIComponent("Статуси «з» і «на» мають бути різні"));
  await setSetting("afterHoursCfg", JSON.stringify(cfg));
  redirect("/settings/after-hours?msg=" + encodeURIComponent(cfg.enabled ? "Збережено й увімкнено" : "Збережено (вимкнено)"));
}

export async function testAfterHours() {
  await requirePerm("settings");
  let msg: string;
  try {
    const r = await runAfterHours(true);
    msg = r.skipped
      ? `Перевірка: ${r.skipped}`
      : `Перевірка: заявок у статусі «з» — ${r.checked}; змінилось би — ${r.changed.length}${r.changed.length ? `: №${r.changed.map((c) => c.id).join(", №")}` : ""}`;
  } catch (e) {
    msg = `Помилка: ${e instanceof Error ? e.message : e}`;
  }
  redirect("/settings/after-hours?msg=" + encodeURIComponent(msg));
}
