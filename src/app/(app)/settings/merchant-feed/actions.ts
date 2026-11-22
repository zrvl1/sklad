"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { setSetting } from "@/lib/util";

export async function saveLabelCfg(formData: FormData) {
  await requirePerm("settings");
  const low = Math.max(0, Number(formData.get("low")) || 100);
  const high = Math.max(low + 1, Number(formData.get("high")) || 250);
  const idField = formData.get("idField") === "sku" ? "sku" : "sdId";
  await setSetting("merchantLabelCfg", JSON.stringify({ low, high, idField }));
  redirect("/settings/merchant-feed?msg=" + encodeURIComponent("Збережено"));
}

export async function newFeedKey() {
  const user = await requirePerm("settings");
  if (user.role !== "admin") redirect("/settings/merchant-feed?msg=" + encodeURIComponent("Лише адміністратор"));
  await setSetting("merchantFeedKey", crypto.randomBytes(24).toString("base64url"));
  redirect("/settings/merchant-feed?msg=" + encodeURIComponent("Створено посилання на фід"));
}
