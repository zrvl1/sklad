import { db } from "./db";

/**
 * Основний товар і картки-комплекти.
 * У SalesDrive один фізичний товар зібраний у кілька карток (різні назви/описи під моделі для SEO).
 * Фізичні операції (прихід, комірки, наліпки, інвентаризація, списання) — лише на основному товарі.
 */

/** Для списку id повертає відповідність id → основний id (картка → основний, решта → сама) */
export async function baseMap(ids: number[]) {
  const rows = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, baseProductId: true } });
  const map = new Map<number, number>();
  for (const id of ids) map.set(id, id);
  for (const r of rows) if (r.baseProductId) map.set(r.id, r.baseProductId);
  return map;
}

/** Замінити картки на основні товари (з урахуванням кількості в картці) у рядках документа */
export async function linesToBase<T extends { productId: number; qty?: number; counted?: number }>(lines: T[]) {
  const rows = await db.product.findMany({
    where: { id: { in: lines.map((l) => l.productId) }, baseProductId: { not: null } },
    select: { id: true, baseProductId: true, kitQty: true },
  });
  const kit = new Map<number, { id: number; baseProductId: number | null; kitQty: number }>(rows.map((r) => [r.id, r]));
  return lines.map((l) => {
    const k = kit.get(l.productId);
    if (!k) return l;
    return {
      ...l,
      productId: k.baseProductId!,
      ...(l.qty !== undefined ? { qty: l.qty * (k.kitQty || 1) } : {}),
      ...(l.counted !== undefined ? { counted: l.counted * (k.kitQty || 1) } : {}),
    };
  });
}

/**
 * Пропозиції зв'язок за артикулом: «CM0361-2» → «CM0361».
 * Перевіряємо, що основний існує, не є сам карткою, і що залишки схожі (картка = основний / к-сть).
 */
export async function detectKits() {
  const products = await db.product.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, sku: true, barcode: true, baseProductId: true, price: true, stocks: { select: { qty: true } } },
  });
  type P = (typeof products)[number];
  const bySku = new Map<string, P>(products.filter((p) => p.sku).map((p) => [p.sku!.toUpperCase(), p]));
  const out: { kit: P; base: P; stockMatch: boolean }[] = [];
  for (const p of products) {
    if (p.baseProductId || !p.sku) continue;
    const m = p.sku.match(/^(.+?)[-_/.](\d{1,3})$/);
    if (!m) continue;
    const base = bySku.get(m[1].toUpperCase());
    if (!base || base.id === p.id || base.baseProductId) continue;
    const ks = p.stocks.reduce((s, x) => s + x.qty, 0);
    const bs = base.stocks.reduce((s, x) => s + x.qty, 0);
    out.push({ kit: p, base, stockMatch: ks === bs });
  }
  return out;
}

export async function linkKit(kitId: number, baseId: number, qty = 1) {
  if (kitId === baseId) throw new Error("Товар не може бути карткою самого себе");
  const base = await db.product.findUniqueOrThrow({ where: { id: baseId } });
  if (base.baseProductId) throw new Error(`«${base.name}» сам є карткою іншого товару — оберіть основний`);
  const hasKits = await db.product.count({ where: { baseProductId: kitId } });
  if (hasKits) throw new Error("Цей товар уже є основним для інших карток — його не можна зробити карткою");
  await db.product.update({ where: { id: kitId }, data: { baseProductId: baseId, kitQty: qty > 0 ? qty : 1 } });
  // фізичне розміщення карток переносимо на основний товар
  await db.productCell.deleteMany({ where: { productId: kitId } });
}

/**
 * Нова ціна основного товару → на всі його картки (локально і в SalesDrive).
 * Повертає текст помилки SalesDrive або null.
 */
export async function propagatePriceToKits(baseIds: number[]) {
  if (!baseIds.length) return null;
  const { isSalesDriveConfigured, productToSd, sdUpdateProducts } = await import("./salesdrive");
  const bases = await db.product.findMany({ where: { id: { in: baseIds } }, select: { id: true, price: true, priceCurrency: true } });
  const changed: number[] = [];
  for (const b of bases) {
    const kits = await db.product.findMany({ where: { baseProductId: b.id, deletedAt: null }, select: { id: true, price: true, kitQty: true } });
    for (const k of kits) {
      const price = Math.round(b.price * (k.kitQty || 1) * 100) / 100;
      if (k.price === price) continue;
      await db.product.update({ where: { id: k.id }, data: { price, priceCurrency: b.priceCurrency } });
      changed.push(k.id);
    }
  }
  if (!changed.length || !isSalesDriveConfigured()) return null;
  const full = await db.product.findMany({ where: { id: { in: changed } } });
  try {
    await sdUpdateProducts(full.filter((p) => p.sdId).map((p) => productToSd(p, null, { withPrice: true })));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Зробити картку основним товаром групи: колишній основний і всі інші картки прив'язуються до неї.
 * Потрібно, коли в SalesDrive фізичний товар — інша картка, ніж визначив автопошук за артикулом.
 * Комірки колишнього основного переносяться на новий.
 */
export async function makeBase(kitId: number) {
  const kit = await db.product.findUniqueOrThrow({ where: { id: kitId } });
  if (!kit.baseProductId) throw new Error("Цей товар уже основний");
  const oldBaseId = kit.baseProductId;
  await db.$transaction(async (tx) => {
    await tx.product.update({ where: { id: kitId }, data: { baseProductId: null, kitQty: 1 } });
    await tx.product.updateMany({ where: { baseProductId: oldBaseId, id: { not: kitId } }, data: { baseProductId: kitId } });
    await tx.product.update({ where: { id: oldBaseId }, data: { baseProductId: kitId, kitQty: 1 } });
    // комірки — на новий основний товар
    const cells = await tx.productCell.findMany({ where: { productId: oldBaseId } });
    for (const c of cells) {
      await tx.productCell.upsert({
        where: { productId_cellId: { productId: kitId, cellId: c.cellId } },
        update: { qty: { increment: c.qty } },
        create: { productId: kitId, cellId: c.cellId, qty: c.qty },
      });
    }
    await tx.productCell.deleteMany({ where: { productId: oldBaseId } });
  });
}
