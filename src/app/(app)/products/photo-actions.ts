"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { ownImageUrl, productImages, warmImages } from "@/lib/images";
import { isSalesDriveConfigured, productToSd, sdUpdateProducts } from "@/lib/salesdrive";
import { logAction } from "@/lib/util";

async function saveAndPush(productId: number, urls: string[]) {
  const p = await db.product.update({ where: { id: productId }, data: { images: JSON.stringify(urls) } });
  if (!p.sdId || !isSalesDriveConfigured()) return null;
  await warmImages(urls);
  try {
    await sdUpdateProducts([productToSd(p, null, { withImages: true, withName: !p.syncedAt })]);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Завантажити фото (браузер уже зменшив їх до ~1600 px JPEG) */
export async function uploadPhotos(productId: number, formData: FormData) {
  const user = await requirePerm("products.edit");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Оберіть фото" };
  if (files.some((f) => f.size > 4 * 1024 * 1024)) return { error: "Фото завелике (до 4 МБ після стиснення)" };
  if (files.some((f) => !/^image\/(jpeg|png|webp)$/.test(f.type))) return { error: "Лише JPEG, PNG або WebP" };
  const p = await db.product.findUniqueOrThrow({ where: { id: productId } });
  const added: string[] = [];
  for (const f of files) {
    const img = await db.productImage.create({ data: { productId, mime: f.type, data: Buffer.from(await f.arrayBuffer()) } });
    added.push(ownImageUrl(img.id));
  }
  const err = await saveAndPush(productId, [...productImages(p.images), ...added]);
  await logAction(user.id, "photos-add", "product", productId, { count: added.length });
  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
  return { ok: true, warn: err ? `Фото збережено, але SalesDrive відповів: ${err}` : null };
}

/** Порядок і склад фото: urls — новий список (перше — головне) */
export async function setPhotos(productId: number, urls: string[]) {
  const user = await requirePerm("products.edit");
  const p = await db.product.findUniqueOrThrow({ where: { id: productId } });
  const allowed = new Set(productImages(p.images));
  const next = urls.filter((u) => allowed.has(u));
  const err = await saveAndPush(productId, next);
  // фото, прибрані з товару і збережені в додатку, — видаляємо з бази
  const removed = [...allowed].filter((u) => !next.includes(u));
  const ids = removed.map((u) => /\/img\/([a-z0-9]+)$/i.exec(u)?.[1]).filter((x): x is string => Boolean(x));
  if (ids.length) await db.productImage.deleteMany({ where: { id: { in: ids }, productId } });
  await logAction(user.id, "photos-set", "product", productId, { count: next.length });
  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
  return { ok: true, warn: err ? `SalesDrive відповів: ${err}` : null };
}
