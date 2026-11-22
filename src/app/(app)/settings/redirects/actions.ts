"use server";

import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { matchRedirects, sitemapPaths } from "@/lib/redirects";
import { xlsxAllStrings } from "@/lib/xlsx";

export async function buildRedirects(formData: FormData) {
  await requirePerm("settings");
  const urls: string[] = [];
  const f = formData.get("file");
  if (f instanceof File && f.size > 0) {
    const buf = Buffer.from(await f.arrayBuffer());
    const strs = /\.xlsx$/i.test(f.name) ? xlsxAllStrings(buf) : buf.toString("utf8").split(/[\s;,]+/);
    urls.push(...strs.filter((s) => /^https?:\/\/(www\.)?crane-moto\.com\//i.test(s.trim())).map((s) => s.trim()));
  }
  urls.push(...String(formData.get("urls") ?? "").split(/\s+/).filter((s) => /^https?:\/\//.test(s)));
  if (!urls.length) redirect(`/settings/redirects?msg=${encodeURIComponent("Не знайшов жодної адреси crane-moto.com у файлі")}`);
  let msg: string;
  try {
    const current = await sitemapPaths();
    const list = matchRedirects([...new Set(urls)], current);
    await db.setting.upsert({ where: { key: "redirects404" }, update: { value: JSON.stringify(list) }, create: { key: "redirects404", value: JSON.stringify(list) } });
    msg = `Готово: ${list.length} редиректів (сторінок на сайті зараз: ${current.length})`;
  } catch (e) {
    msg = `Помилка: ${e instanceof Error ? e.message : e}`;
  }
  redirect(`/settings/redirects?msg=${encodeURIComponent(msg)}`);
}
