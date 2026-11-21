"use server";

import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_TEMPLATES, SHOP_FIELDS } from "@/lib/messages";

const put = (key: string, value: string) => db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });

export async function saveMsgSettings(formData: FormData) {
  await requirePerm("settings");
  const shop: Record<string, string> = {};
  for (const f of SHOP_FIELDS) shop[f.key] = String(formData.get(`s_${f.key}`) ?? "").trim();
  const tpls: Record<string, string> = {};
  for (const t of DEFAULT_TEMPLATES) {
    const v = String(formData.get(`t_${t.key}`) ?? "").replace(/\r\n/g, "\n").trim();
    if (v && v !== t.text) tpls[t.key] = v; // зберігаємо лише змінені — решта береться зі стандартних
  }
  await put("msgShop", JSON.stringify(shop));
  await put("msgTemplates", JSON.stringify(tpls));
  redirect("/messages/settings?saved=1");
}

export async function saveListStatuses(formData: FormData) {
  await requirePerm("settings");
  const ids = formData.getAll("st").map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 3);
  await put("msgStatusIds", JSON.stringify(ids));
  redirect("/messages");
}
