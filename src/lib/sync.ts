import { db } from "./db";
import { fetchYmlText, parseYml } from "./salesdrive";
import { buildSearch, setSetting } from "./util";

/**
 * Імпорт/оновлення товарів із YML SalesDrive.
 * Оновлює дані товару і залишок складу "за замовчуванням" (YML віддає залишок одного обраного складу).
 * Комірки, приходи та інші наші дані не чіпає.
 */
export async function syncFromYml() {
  const offers = parseYml(await fetchYmlText());
  const defaultWh = await db.warehouse.findFirst({ where: { isDefault: true } });
  const now = new Date();

  // Один запит замість сотень: які товари вже є в базі
  const existing = new Map(
    (await db.product.findMany({ where: { sdId: { not: null } }, select: { id: true, sdId: true } })).map((p) => [p.sdId as string, p.id])
  );
  let created = 0;
  let updated = 0;

  for (let i = 0; i < offers.length; i += 100) {
    const batch = offers.slice(i, i + 100);
    await db.$transaction(
      async (tx) => {
        for (const o of batch) {
          const data = {
            name: o.name,
            price: o.price,
            sku: o.sku,
            barcode: o.barcode,
            manufacturer: o.manufacturer,
            categorySdId: o.categoryId,
            categoryName: o.categoryName,
            search: buildSearch({ name: o.name, sku: o.sku, barcode: o.barcode, sdId: o.sdId }),
            syncedAt: now,
            ...(o.cost !== null ? { cost: o.cost } : {}),
          };
          const id = existing.get(o.sdId);
          const product = id
            ? await tx.product.update({ where: { id }, data, select: { id: true } })
            : await tx.product.create({ data: { ...data, sdId: o.sdId }, select: { id: true } });
          if (id) updated++;
          else {
            created++;
            existing.set(o.sdId, product.id);
          }

          if (defaultWh && o.qty !== null) {
            await tx.stockBalance.upsert({
              where: { productId_warehouseId: { productId: product.id, warehouseId: defaultWh.id } },
              update: { qty: o.qty },
              create: { productId: product.id, warehouseId: defaultWh.id, qty: o.qty },
            });
          }
        }
      },
      // віддалена база відповідає повільніше за локальний файл — даємо транзакції більше часу
      { timeout: 120_000, maxWait: 20_000 }
    );
  }

  await setSetting("lastSync", JSON.stringify({ at: now.toISOString(), total: offers.length, created, updated }));
  return { total: offers.length, created, updated };
}
