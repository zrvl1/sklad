import { db } from "./db";
import { buildSearch } from "./util";

const productSelect = { id: true, name: true, sku: true, barcode: true, price: true, cost: true, sdId: true } as const;

export type FoundProduct = {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  cost: number;
  sdId: string | null;
  matchedBy?: string;
};

/**
 * Точний пошук товару за будь-яким кодом: штрихкод, артикул (SKU), ID SalesDrive,
 * артикул постачальника або додатковий штрихкод.
 */
export async function findByCode(raw: string): Promise<FoundProduct[]> {
  const code = raw.trim();
  if (!code) return [];
  const direct = await db.product.findMany({
    where: { deletedAt: null, OR: [{ barcode: code }, { sku: code }, { sdId: code }] },
    select: productSelect,
    take: 5,
  });
  const viaCodes = await db.productCode.findMany({
    where: { code, product: { deletedAt: null } },
    include: { product: { select: productSelect }, supplier: { select: { name: true } } },
    take: 5,
  });
  const seen = new Set<number>();
  const out: FoundProduct[] = [];
  for (const p of direct) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ ...p, matchedBy: p.barcode === code ? "штрихкод" : p.sku === code ? "артикул" : "ID" });
  }
  for (const c of viaCodes) {
    if (seen.has(c.product.id)) continue;
    seen.add(c.product.id);
    out.push({ ...c.product, matchedBy: c.type === "supplier" ? `арт. постачальника${c.supplier ? ` (${c.supplier.name})` : ""}` : "дод. штрихкод" });
  }
  return out;
}

/** Пошук: спершу точний за кодом, інакше за частиною назви/коду */
export async function searchProducts(q: string, take = 20): Promise<FoundProduct[]> {
  const exact = await findByCode(q);
  if (exact.length) return exact;
  return db.product.findMany({
    where: { deletedAt: null, search: { contains: q.trim().toLowerCase() } },
    select: productSelect,
    orderBy: { name: "asc" },
    take,
  });
}

/** Перебудувати рядок пошуку товару (після зміни кодів) */
export async function refreshSearch(productId: number) {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { codes: { select: { code: true } } } });
  await db.product.update({
    where: { id: productId },
    data: { search: buildSearch(p, p.codes.map((c) => c.code)) },
  });
}

/** Перевірка, чи код уже зайнятий іншим товаром (штрихкод, SKU або додатковий код) */
export async function codeOwner(code: string, exceptProductId?: number) {
  const found = await findByCode(code);
  return found.find((f) => f.id !== exceptProductId) ?? null;
}

/** Прив'язати код до товару */
export async function addCode(productId: number, code: string, type: "supplier" | "barcode", supplierId: number | null) {
  const c = code.trim();
  if (!c) throw new Error("Порожній код");
  const owner = await codeOwner(c, productId);
  if (owner) throw new Error(`Код ${c} вже належить товару «${owner.name}»`);
  await db.productCode.upsert({
    where: { code: c },
    update: { productId, type, supplierId },
    create: { productId, code: c, type, supplierId },
  });
  await refreshSearch(productId);
}
