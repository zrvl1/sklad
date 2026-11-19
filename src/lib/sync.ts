import { db } from "./db";
import { fetchYmlText, parseYml } from "./salesdrive";
import { buildSearch, setSetting } from "./util";
import { reconcileCells } from "./stock";
import { refreshRates } from "./currency";
import { recordDeletion } from "./deleted";

export const currencyEnabled = () => process.env.ENABLE_CURRENCY === "true";

/**
 * Імпорт/оновлення товарів із YML SalesDrive.
 * - оновлює назву, ціну, коди, категорію, опис і характеристики (якщо вони є в YML), залишок складу за замовчуванням;
 * - товари, яких більше немає в SalesDrive, позначає видаленими і додає в журнал «Видалені товари» (для Prom/Horoshop);
 * - комірки, приходи та інші наші дані не чіпає.
 */
export async function syncFromYml() {
  const offers = parseYml(await fetchYmlText());
  if (currencyEnabled()) {
    try {
      await refreshRates();
    } catch {
      /* якщо в ключа немає права на курси — не заважає синхронізації товарів */
    }
  }
  const defaultWh = await db.warehouse.findFirst({ where: { isDefault: true } });
  const now = new Date();

  // Один запит замість сотень: які товари вже є в базі
  const existing = new Map<string, number>(
    (await db.product.findMany({ where: { sdId: { not: null } }, select: { id: true, sdId: true } })).map((p) => [p.sdId as string, p.id])
  );
  // Додаткові коди (артикули постачальників), щоб вони не випали з пошуку після оновлення
  const codesByProduct = new Map<number, string[]>();
  for (const c of await db.productCode.findMany({ select: { productId: true, code: true } })) {
    codesByProduct.set(c.productId, [...(codesByProduct.get(c.productId) ?? []), c.code]);
  }
  // Товари, собівартість яких ми ведемо у валюті: її не перезаписуємо з YML
  const foreignCost = new Set(
    (await db.product.findMany({ where: { costCurrency: { not: null, notIn: ["UAH"] } }, select: { sdId: true } }))
      .map((p) => p.sdId)
      .filter((x): x is string => Boolean(x))
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
            priceCurrency: o.priceCurrency,
            sku: o.sku,
            barcode: o.barcode,
            manufacturer: o.manufacturer,
            ...(o.country ? { country: o.country } : {}),
            ...(o.keywords !== undefined ? { keywords: o.keywords } : {}),
            ...(o.keywordsUa !== undefined ? { keywordsUa: o.keywordsUa } : {}),
            categorySdId: o.categoryId,
            categoryName: o.categoryName,
            search: buildSearch(
              { name: o.name, sku: o.sku, barcode: o.barcode, sdId: o.sdId },
              codesByProduct.get(existing.get(o.sdId) ?? -1)
            ),
            syncedAt: now,
            deletedAt: null, // товар є в SalesDrive — отже не видалений
            ...(o.cost !== null && !foreignCost.has(o.sdId) ? { cost: o.cost } : {}),
            // опис і характеристики — лише якщо в YML-експорті увімкнено «опис, фото та характеристики»
            ...(o.description !== undefined ? { description: o.description } : {}),
            ...(o.params !== undefined ? { params: JSON.stringify(o.params) } : {}),
            ...(o.nameTranslate !== undefined ? { nameTranslate: o.nameTranslate } : {}),
            ...(o.descriptionTranslate !== undefined ? { descriptionTranslate: o.descriptionTranslate } : {}),
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

  // Чи віддає YML опис і характеристики (увімкнено в експорті) — від цього залежить, чи можна масово застосовувати шаблони
  await setSetting("ymlHasDetails", offers.some((o) => o.description !== undefined || o.params !== undefined) ? "1" : "0");
  await setSetting("syncWarning", "");
  const removed = await detectDeleted(new Set(offers.map((o) => o.sdId)));
  const cellsReduced = defaultWh ? await reconcileCells(defaultWh.id) : 0;
  await (await import("./kits")).autoConfirmKits();
  await setSetting("lastSync", JSON.stringify({ at: now.toISOString(), total: offers.length, created, updated, removed, cellsReduced }));
  return { total: offers.length, created, updated, removed, cellsReduced };
}

/**
 * Товари, які були в SalesDrive, але зникли з YML, — видалені в CRM.
 * Захист: якщо YML раптом прийшов неповний (зникло більше 20% товарів), нічого не позначаємо.
 */
async function detectDeleted(present: Set<string>) {
  const active = await db.product.findMany({
    where: {
      deletedAt: null,
      sdId: { not: null },
      syncedAt: { not: null },
      createdAt: { lt: new Date(Date.now() - 20 * 60 * 1000) }, // щойно створені могли ще не потрапити в YML (він оновлюється раз на кілька хвилин)
    },
  });
  const missing = active.filter((p) => !present.has(p.sdId!));
  if (!missing.length) return 0;
  if (missing.length > Math.max(5, active.length * 0.2)) {
    await setSetting("syncWarning", `YML без ${missing.length} товарів із ${active.length} — схоже на збій, видалення не позначено`);
    return 0;
  }
  for (const p of missing) {
    await db.product.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
    await recordDeletion(p, "crm", null, "Видалено в SalesDrive");
  }
  return missing.length;
}
