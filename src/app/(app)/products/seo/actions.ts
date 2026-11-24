"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { readXlsx } from "@/lib/xlsx";
import { SEO_COLS } from "@/lib/seoFile";
import { parseParams } from "@/lib/salesdrive";
import { logAction } from "@/lib/util";
import { refreshSearch } from "@/lib/codes";
import { pushProduct } from "../actions";

const back = (msg: string, err = false) => {
  revalidatePath("/products/seo");
  redirect(`/products/seo?${err ? "err" : "msg"}=${encodeURIComponent(msg)}`);
};

/** Завантажити заповнений SEO-файл: оновити назви, описи, запити, характеристики → SalesDrive */
export async function importSeo(formData: FormData) {
  const user = await requirePerm("products.edit");
  const f = formData.get("file");
  if (!(f instanceof File) || !f.size) return back("Оберіть файл .xlsx", true);
  let rows: string[][];
  try {
    rows = readXlsx(Buffer.from(await f.arrayBuffer()));
  } catch (e) {
    return back(`Не вдалося прочитати файл: ${e instanceof Error ? e.message : e}`, true);
  }
  // колонки шукаємо за заголовком (порядок можна міняти)
  const head = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (title: string) => head.findIndex((h) => h === title.toLowerCase());
  const c = Object.fromEntries(SEO_COLS.map((t) => [t, col(t)])) as Record<(typeof SEO_COLS)[number], number>;
  if (c["ID"] < 0) return back("У файлі немає колонки «ID» — використовуйте файл, вивантажений з цієї сторінки", true);
  const get = (r: string[], t: (typeof SEO_COLS)[number]) => (c[t] >= 0 ? (r[c[t]] ?? "").trim() : "");

  let updated = 0;
  const errors: string[] = [];
  for (const r of rows.slice(1)) {
    const id = Number(get(r, "ID"));
    if (!id) continue;
    const nameUa = get(r, "НОВА назва UA");
    const nameRu = get(r, "НОВА назва RU");
    const descUa = get(r, "НОВИЙ опис UA (HTML)");
    const descRu = get(r, "НОВИЙ опис RU (HTML)");
    const kwUa = get(r, "Запити UA");
    const kwRu = get(r, "Запити RU");
    const addParams = get(r, "Характеристики додати/змінити (Назва: значення, кожна з нового рядка)")
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([^:]+?)\s*:\s*(.+?)\s*$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => ({ name: m[1], type: "text", value: m[2] }));
    if (!nameUa && !nameRu && !descUa && !descRu && !kwUa && !kwRu && !addParams.length) continue;
    const p = await db.product.findUnique({ where: { id } });
    if (!p || p.deletedAt) {
      errors.push(`ID ${id}: товар не знайдено`);
      continue;
    }
    const data: Record<string, string | Date | null> = { seoAt: new Date(), textEditedAt: new Date() };
    if (nameRu) data.name = nameRu.slice(0, 250);
    if (nameUa) data.nameTranslate = nameUa.slice(0, 250);
    if (descRu) data.description = descRu;
    if (descUa) data.descriptionTranslate = descUa;
    if (kwRu) data.keywords = kwRu;
    if (kwUa) data.keywordsUa = kwUa;
    if (addParams.length) {
      const cur = parseParams(p.params).filter((x) => !addParams.some((a) => a.name.toLowerCase() === x.name.toLowerCase()));
      data.params = JSON.stringify([...cur, ...addParams]);
    }
    await db.product.update({ where: { id }, data });
    await refreshSearch(id); // пошук за новими назвами (і кодами постачальника)
    const push = await pushProduct(id, { withName: Boolean(nameRu || nameUa), withDetails: true, paramsMode: "replace" });
    if (!push.ok) errors.push(`ID ${id}: SalesDrive — ${push.error}`);
    updated++;
  }
  await logAction(user.id, "seo-import", "product", null, { updated, errors: errors.length });
  if (!updated && !errors.length) return back("У файлі немає заповнених колонок «НОВА назва / НОВИЙ опис / Запити»", true);
  back(`Оновлено товарів: ${updated}.${errors.length ? ` Проблеми (${errors.length}): ${errors.slice(0, 5).join("; ")}` : " Усе відправлено в SalesDrive."}`, errors.length > 0 && !updated);
}
