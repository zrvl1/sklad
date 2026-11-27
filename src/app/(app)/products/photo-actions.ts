"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { ownImageUrl, productImages, warmImages } from "@/lib/images";
import { isSalesDriveConfigured, productToSd, sdUpdateProducts } from "@/lib/salesdrive";
import { logAction } from "@/lib/util";
import { enlargeIfSmall, imageSize, MIN_SIDE } from "@/lib/imageFix";
import { robustGet } from "@/lib/robustFetch";

async function saveAndPush(productId: number, urls: string[]) {
  const p = await db.product.update({ where: { id: productId }, data: { images: JSON.stringify(urls) } });
  if (!p.sdId || !isSalesDriveConfigured()) return null;
  await warmImages(urls);
  try {
    try {
      await sdUpdateProducts([productToSd(p, null, { withImages: true, withName: !p.syncedAt })]);
    } catch (e) {
      // товару ще немає в SalesDrive — створюємо повністю
      if (!(e instanceof Error && /required field/i.test(e.message))) throw e;
      await sdUpdateProducts([productToSd(p, null, { withImages: true, withName: true, withPrice: true, withCost: true, withDetails: true })]);
    }
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
    const fixed = await enlargeIfSmall(Buffer.from(await f.arrayBuffer()), f.type);
    const img = await db.productImage.create({ data: { productId, mime: fixed.mime, data: fixed.buf } });
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

/**
 * Замалі фото (менша сторона < 500 px — Google Merchant їх скоро не прийматиме):
 * збільшуємо на білому квадраті 1000×1000, зберігаємо під НОВОЮ адресою (щоб SalesDrive/Хорошоп/Google забрали заново)
 * і відправляємо в SalesDrive. Обробляємо порціями, щоб вкластися в час запиту.
 */
export async function fixSmallPhotos(dryRun = false, fromId = 0) {
  const user = await requirePerm("products.edit");
  const started = Date.now();
  const products = await db.product.findMany({
    where: { deletedAt: null, images: { not: null }, id: { gt: fromId } },
    select: { id: true, images: true },
    orderBy: { id: "asc" },
  });
  let checked = 0, fixed = 0, small = 0, failed = 0;
  const fixedIds: number[] = [];
  let timedOut = false;
  let lastId = fromId;
  for (const p of products) {
    if (Date.now() - started > 45_000) { timedOut = true; break; }
    lastId = p.id;
    const urls = productImages(p.images);
    if (!urls.length) continue;
    checked++;
    const next: string[] = [];
    const oldIds: string[] = [];
    let changed = false;
    for (const u of urls) {
      try {
        const own = /\/img\/([a-z0-9]+)(?:\.\w+)?$/i.exec(u)?.[1];
        let buf: Buffer, mime: string;
        if (own) {
          const img = await db.productImage.findUnique({ where: { id: own } });
          if (!img) { next.push(u); continue; }
          buf = Buffer.from(img.data); mime = img.mime;
        } else {
          const r = await robustGet(u, 15000);
          if (r.status !== 200) { next.push(u); continue; }
          buf = r.body; mime = r.type.split(";")[0] || "image/jpeg";
        }
        const sz = await imageSize(buf);
        if (!sz || Math.min(sz.w, sz.h) >= MIN_SIDE) { next.push(u); continue; }
        small++;
        if (dryRun) { next.push(u); continue; }
        const big = await enlargeIfSmall(buf, mime);
        if (!big.changed) { next.push(u); failed++; continue; }
        const img = await db.productImage.create({ data: { productId: p.id, mime: big.mime, data: big.buf } });
        next.push(ownImageUrl(img.id));
        if (own) oldIds.push(own);
        changed = true;
      } catch {
        next.push(u);
        failed++;
      }
    }
    if (changed) {
      const err = await saveAndPush(p.id, next);
      if (err) failed++;
      if (oldIds.length) await db.productImage.deleteMany({ where: { id: { in: oldIds }, productId: p.id } });
      fixed++;
      fixedIds.push(p.id);
    }
  }
  if (!dryRun && fixed) await logAction(user.id, "photos-enlarge", "product", 0, { count: fixed, ids: fixedIds });
  revalidatePath("/products");
  return { ok: true as const, checked, small, fixed, failed, timedOut, lastId, fixedIds };
}
