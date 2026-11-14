import { db } from "./db";

/**
 * Узгодження комірок із залишком SalesDrive.
 * Коли товар продали в CRM, залишок у SalesDrive зменшується, а комірки про це не знають.
 * Якщо в комірках лежить більше, ніж є на складі, зменшуємо кількість у комірках
 * (спершу ті, де лежить найменше) і записуємо це в журнал руху як "автосписання після продажу".
 * Сама прив'язка товару до комірки (місце зберігання) залишається навіть із кількістю 0.
 */
export async function reconcileCells(warehouseId: number) {
  const [stocks, cells] = await Promise.all([
    db.stockBalance.findMany({ where: { warehouseId }, select: { productId: true, qty: true } }),
    db.productCell.findMany({ where: { qty: { gt: 0 }, cell: { warehouseId } }, orderBy: { qty: "asc" } }),
  ]);
  const stock = new Map<number, number>(stocks.map((s) => [s.productId, Math.max(0, s.qty)]));
  // Товари з недавнім приходом чи інвентаризацією пропускаємо: YML міг ще не оновитися,
  // і ми помилково "списали" б щойно розкладений товар.
  const recent = await db.stockMove.findMany({
    where: { warehouseId, type: { in: ["receipt", "inventory"] }, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    select: { productId: true },
  });
  for (const r of recent) stock.delete(r.productId);
  const byProduct = new Map<number, typeof cells>();
  for (const c of cells) byProduct.set(c.productId, [...(byProduct.get(c.productId) ?? []), c]);

  const changes: { productId: number; cellId: number; take: number }[] = [];
  for (const [productId, list] of byProduct) {
    if (!stock.has(productId)) continue; // залишок невідомий — не чіпаємо
    let excess = list.reduce((s, c) => s + c.qty, 0) - (stock.get(productId) ?? 0);
    for (const c of list) {
      if (excess <= 1e-9) break;
      const take = Math.min(c.qty, excess);
      changes.push({ productId, cellId: c.cellId, take });
      excess -= take;
    }
  }
  for (let i = 0; i < changes.length; i += 100) {
    const batch = changes.slice(i, i + 100);
    await db.$transaction(
      batch.flatMap((ch) => [
        db.productCell.update({
          where: { productId_cellId: { productId: ch.productId, cellId: ch.cellId } },
          data: { qty: { decrement: ch.take } },
        }),
        db.stockMove.create({
          data: {
            productId: ch.productId,
            warehouseId,
            cellId: ch.cellId,
            qty: -ch.take,
            type: "sale-auto",
            note: "Залишок у SalesDrive зменшився (продаж або списання в CRM)",
          },
        }),
      ])
    );
  }
  return changes.length;
}

/** Перемістити товар між комірками одного складу */
export async function moveBetweenCells(opts: { productId: number; fromCellId: number | null; toCellId: number; qty: number; userId: number }) {
  const { productId, fromCellId, toCellId, qty, userId } = opts;
  if (qty <= 0) throw new Error("Кількість має бути більшою за 0");
  if (fromCellId === toCellId) throw new Error("Комірки однакові");
  const to = await db.cell.findUniqueOrThrow({ where: { id: toCellId } });
  await db.$transaction(async (tx) => {
    if (fromCellId) {
      const from = await tx.productCell.findUnique({ where: { productId_cellId: { productId, cellId: fromCellId } } });
      if (!from || from.qty < qty - 1e-9) throw new Error(`У комірці лише ${from?.qty ?? 0} шт`);
      await tx.productCell.update({ where: { productId_cellId: { productId, cellId: fromCellId } }, data: { qty: { decrement: qty } } });
      await tx.stockMove.create({
        data: { productId, warehouseId: to.warehouseId, cellId: fromCellId, qty: -qty, type: "cell-move", note: `→ ${to.code}`, userId },
      });
    }
    await tx.productCell.upsert({
      where: { productId_cellId: { productId, cellId: toCellId } },
      update: { qty: { increment: qty } },
      create: { productId, cellId: toCellId, qty },
    });
    await tx.stockMove.create({
      data: { productId, warehouseId: to.warehouseId, cellId: toCellId, qty, type: "cell-move", note: fromCellId ? "переміщення" : "розміщення", userId },
    });
  });
}

/** Встановити кількість товару в комірці (ручне коригування) */
export async function setCellQty(opts: { productId: number; cellId: number; qty: number; userId: number }) {
  const { productId, cellId, qty, userId } = opts;
  const cell = await db.cell.findUniqueOrThrow({ where: { id: cellId } });
  const cur = await db.productCell.findUnique({ where: { productId_cellId: { productId, cellId } } });
  const diff = qty - (cur?.qty ?? 0);
  await db.$transaction([
    db.productCell.upsert({
      where: { productId_cellId: { productId, cellId } },
      update: { qty },
      create: { productId, cellId, qty },
    }),
    ...(Math.abs(diff) > 1e-9
      ? [db.stockMove.create({ data: { productId, warehouseId: cell.warehouseId, cellId, qty: diff, type: "cell-adjust", note: "ручне коригування", userId } })]
      : []),
  ]);
}
