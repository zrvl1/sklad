import type { Product } from "@prisma/client";
import { db } from "./db";
import { getSetting } from "./util";

export const DEFAULT_SITES = ["Prom", "Horoshop"];

/** Сайти/маркетплейси, де треба вручну прибирати видалені товари (Налаштування) */
export async function getSites(): Promise<string[]> {
  const raw = await getSetting("sites");
  if (!raw) return DEFAULT_SITES;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String).filter(Boolean) : DEFAULT_SITES;
  } catch {
    return DEFAULT_SITES;
  }
}

/** Записати видалений товар у журнал і створити завдання «видалити на сайті» для кожного сайту */
export async function recordDeletion(p: Product, source: "app" | "crm", userId: number | null, reason?: string | null) {
  const sites = await getSites();
  await db.deletedProduct.create({
    data: {
      productId: p.id,
      sdId: p.sdId,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      categoryName: p.categoryName,
      price: p.price,
      source,
      reason: reason ?? null,
      deletedById: userId,
      sites: { create: sites.map((site) => ({ site })) },
    },
  });
}
