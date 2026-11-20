"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { isSalesDriveConfigured, productToSd, sdUpdateProducts } from "@/lib/salesdrive";
import { buildSearch, logAction } from "@/lib/util";

/** Зберегти нові назви (UA і RU) і відправити в SalesDrive → YML → сайт і Prom */
export async function saveDupNames(formData: FormData) {
  const user = await requirePerm("products.edit");
  const changed: number[] = [];
  for (const [k, v] of formData.entries()) {
    const m = k.match(/^ua_(\d+)$/);
    if (!m) continue;
    const id = Number(m[1]);
    const newUa = String(v).trim();
    const newRu = String(formData.get(`ru_${id}`) ?? "").trim();
    const p = await db.product.findUnique({ where: { id } });
    if (!p || !newUa || !newRu) continue;
    if (newUa === (p.nameTranslate ?? p.name) && newRu === p.name) continue;
    const data = { name: newRu, nameTranslate: newUa };
    await db.product.update({
      where: { id },
      data: { ...data, textEditedAt: new Date(), search: buildSearch({ ...p, ...data }) },
    });
    changed.push(id);
  }
  let sdErr = "";
  if (changed.length && isSalesDriveConfigured()) {
    const full = await db.product.findMany({ where: { id: { in: changed }, sdId: { not: null } } });
    try {
      for (let i = 0; i < full.length; i += 100) await sdUpdateProducts(full.slice(i, i + 100).map((p) => productToSd(p, null, { withName: true })));
      await db.product.updateMany({ where: { id: { in: full.map((p) => p.id) } }, data: { syncError: null, syncedAt: new Date() } });
    } catch (e) {
      sdErr = e instanceof Error ? e.message : String(e);
      await db.product.updateMany({ where: { id: { in: changed } }, data: { syncError: sdErr.slice(0, 300) } });
    }
  }
  await logAction(user.id, "dup-names", "product", null, `змінено ${changed.length}${sdErr ? `; SalesDrive: ${sdErr}` : ""}`);
  revalidatePath("/products/dupes");
  redirect(`/products/dupes?msg=${encodeURIComponent(`Перейменовано: ${changed.length}${sdErr ? `. Помилка SalesDrive: ${sdErr.slice(0, 200)}` : ". Відправлено в SalesDrive — на сайті й Prom зміниться з наступним імпортом."}`)}`);
}
