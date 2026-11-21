"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAction } from "@/lib/util";

/** Зберегти нові ціни і передати їх у SalesDrive (звідти — на сайт і Prom) */
export async function savePrices(changes: { id: number; price: number }[]) {
  const user = await requirePerm("products.edit");
  const valid = changes.filter((c) => Number.isFinite(c.price) && c.price > 0).slice(0, 500);
  if (!valid.length) return { ok: false, text: "Немає змін" };
  const before = await db.product.findMany({ where: { id: { in: valid.map((c) => c.id) } }, select: { id: true, price: true } });
  const old = new Map(before.map((b) => [b.id, b.price]));
  for (const c of valid) await db.product.update({ where: { id: c.id }, data: { price: c.price } });
  await logAction(user.id, "reprice", "products", null, valid.map((c) => ({ id: c.id, from: old.get(c.id), to: c.price })));

  let sdNote = "";
  const { isSalesDriveConfigured, productToSd, sdUpdateProducts } = await import("@/lib/salesdrive");
  if (isSalesDriveConfigured()) {
    const ps = await db.product.findMany({ where: { id: { in: valid.map((c) => c.id) }, sdId: { not: null } } });
    try {
      await sdUpdateProducts(ps.map((p) => productToSd(p, null, { withPrice: true })));
      await db.product.updateMany({ where: { id: { in: ps.map((p) => p.id) } }, data: { syncError: null, syncedAt: new Date() } });
      sdNote = ", передано в SalesDrive";
    } catch (e) {
      sdNote = `, але SalesDrive не прийняв: ${e instanceof Error ? e.message : e}`;
    }
  }
  // ціна основного товару → на всі його картки-комплекти
  const { propagatePriceToKits } = await import("@/lib/kits");
  const kitErr = await propagatePriceToKits(valid.map((c) => c.id));
  if (kitErr) sdNote += `; ціни карток не передано в SalesDrive: ${kitErr}`;
  revalidatePath("/products/repricing");
  revalidatePath("/products");
  return { ok: !sdNote.includes("не прийняв") && !kitErr, text: `Змінено цін: ${valid.length}${sdNote}` };
}
