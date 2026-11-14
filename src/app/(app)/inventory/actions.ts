"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isSalesDriveConfigured, productToSd, sdUpdateProducts } from "@/lib/salesdrive";
import { syncFromYml } from "@/lib/sync";
import { logAction } from "@/lib/util";

export type InventoryLineInput = { productId: number; cellId: number | null; counted: number };

export async function createInventory(formData: FormData) {
  const user = await requireUser();
  const warehouseId =
    Number(formData.get("warehouseId")) || (await db.warehouse.findFirst({ where: { isDefault: true } }))?.id || (await db.warehouse.findFirst())?.id;
  if (!warehouseId) throw new Error("Спершу створіть склад");
  const inv = await db.inventory.create({
    data: { number: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, warehouseId, createdById: user.id },
  });
  await db.inventory.update({ where: { id: inv.id }, data: { number: `І-${String(inv.id).padStart(6, "0")}` } });
  await logAction(user.id, "create", "inventory", inv.id);
  redirect(`/inventory/${inv.id}`);
}

export async function saveInventory(id: number, note: string, lines: InventoryLineInput[]) {
  const user = await requireUser();
  const inv = await db.inventory.findUnique({ where: { id } });
  if (!inv || inv.status !== "draft") return { ok: false as const, error: "Документ уже проведено або не існує" };
  const clean = lines.filter((l) => l.productId && l.counted >= 0);
  await db.$transaction([
    db.inventoryLine.deleteMany({ where: { inventoryId: id } }),
    db.inventory.update({
      where: { id },
      data: { note: note.trim() || null, lines: { create: clean.map((l) => ({ productId: l.productId, cellId: l.cellId, counted: l.counted })) } },
    }),
  ]);
  await logAction(user.id, "save", "inventory", id, { lines: clean.length });
  return { ok: true as const };
}

/**
 * Проведення інвентаризації:
 * 1) свіжі залишки з SalesDrive; 2) для кожного пораховного товару новий залишок = пораховано;
 * 3) відправляємо в SalesDrive лише ті, де є розбіжність; 4) оновлюємо комірки й журнал руху.
 * Товари, яких не рахували, не змінюються.
 * zeroMissing — у перерахованих комірках обнулити товари, яких не відскановано (лише комірки, не залишок у CRM).
 */
export async function postInventory(id: number, zeroMissing: boolean) {
  const user = await requireUser();
  const inv = await db.inventory.findUnique({ where: { id }, include: { lines: true, warehouse: true } });
  if (!inv) return { ok: false as const, error: "Документ не знайдено" };
  if (inv.status !== "draft") return { ok: false as const, error: "Документ уже проведено" };
  if (!inv.lines.length) return { ok: false as const, error: "Нічого не пораховано" };

  const sdOn = isSalesDriveConfigured();
  if (sdOn && !inv.warehouse.isDefault)
    return { ok: false as const, error: "Поки що інвентаризація проводиться лише для складу за замовчуванням (так само, як прихід)." };
  if (sdOn && process.env.SALESDRIVE_YML_URL) {
    try {
      await syncFromYml();
    } catch (e) {
      return { ok: false as const, error: `Не вдалося оновити залишки з SalesDrive: ${e instanceof Error ? e.message : e}` };
    }
  }

  const counted = new Map<number, number>();
  for (const l of inv.lines) counted.set(l.productId, (counted.get(l.productId) ?? 0) + l.counted);
  const ids = [...counted.keys()];
  const [products, stocks] = await Promise.all([
    db.product.findMany({ where: { id: { in: ids } } }),
    db.stockBalance.findMany({ where: { warehouseId: inv.warehouseId, productId: { in: ids } } }),
  ]);
  const system = new Map<number, number>(stocks.map((s) => [s.productId, s.qty]));
  const changed = products.filter((p) => Math.abs((counted.get(p.id) ?? 0) - (system.get(p.id) ?? 0)) > 1e-9);

  if (sdOn && changed.length) {
    try {
      await sdUpdateProducts(changed.map((p) => productToSd(p, { sdStockId: inv.warehouse.sdStockId, qty: counted.get(p.id) ?? 0 }, {})));
    } catch (e) {
      return { ok: false as const, error: `SalesDrive не прийняв дані, інвентаризацію не проведено: ${e instanceof Error ? e.message : e}` };
    }
  }

  // Комірки, які перераховували
  const cellIds = [...new Set(inv.lines.map((l) => l.cellId).filter((c): c is number => c !== null))];
  const cellCounted = new Map<string, number>();
  for (const l of inv.lines) if (l.cellId) cellCounted.set(`${l.productId}:${l.cellId}`, (cellCounted.get(`${l.productId}:${l.cellId}`) ?? 0) + l.counted);
  const currentCells = cellIds.length ? await db.productCell.findMany({ where: { cellId: { in: cellIds } } }) : [];

  const now = new Date();
  try {
    await db.$transaction(
      async (tx) => {
        const claimed = await tx.inventory.updateMany({ where: { id, status: "draft" }, data: { status: "posted", postedAt: now } });
        if (claimed.count === 0) throw new Error("Документ уже проведено");
        for (const l of inv.lines) await tx.inventoryLine.update({ where: { id: l.id }, data: { systemQty: system.get(l.productId) ?? 0 } });

        for (const p of products) {
          const newQty = counted.get(p.id) ?? 0;
          const diff = newQty - (system.get(p.id) ?? 0);
          await tx.stockBalance.upsert({
            where: { productId_warehouseId: { productId: p.id, warehouseId: inv.warehouseId } },
            update: { qty: newQty },
            create: { productId: p.id, warehouseId: inv.warehouseId, qty: newQty },
          });
          if (Math.abs(diff) > 1e-9) {
            await tx.stockMove.create({
              data: { productId: p.id, warehouseId: inv.warehouseId, qty: diff, type: "inventory", docType: "inventory", docId: id, userId: user.id, note: "залишок у CRM" },
            });
          }
        }

        // Комірки: пораховане — встановлюємо; не відскановане в перерахованих комірках — обнуляємо (якщо обрано)
        const seen = new Set<string>();
        for (const [key, qty] of cellCounted) {
          seen.add(key);
          const [productId, cellId] = key.split(":").map(Number);
          const cur = currentCells.find((c) => c.productId === productId && c.cellId === cellId)?.qty ?? 0;
          await tx.productCell.upsert({
            where: { productId_cellId: { productId, cellId } },
            update: { qty },
            create: { productId, cellId, qty },
          });
          if (Math.abs(qty - cur) > 1e-9)
            await tx.stockMove.create({
              data: { productId, warehouseId: inv.warehouseId, cellId, qty: qty - cur, type: "inventory", docType: "inventory", docId: id, userId: user.id, note: "комірка" },
            });
        }
        if (zeroMissing) {
          for (const c of currentCells) {
            if (seen.has(`${c.productId}:${c.cellId}`) || c.qty <= 0) continue;
            await tx.productCell.update({ where: { productId_cellId: { productId: c.productId, cellId: c.cellId } }, data: { qty: 0 } });
            await tx.stockMove.create({
              data: {
                productId: c.productId,
                warehouseId: inv.warehouseId,
                cellId: c.cellId,
                qty: -c.qty,
                type: "inventory",
                docType: "inventory",
                docId: id,
                userId: user.id,
                note: "не знайдено в комірці",
              },
            });
          }
        }
      },
      { timeout: 120_000, maxWait: 20_000 }
    );
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }

  await logAction(user.id, "post", "inventory", id, { products: products.length, changed: changed.length });
  revalidatePath(`/inventory/${id}`);
  revalidatePath("/inventory");
  return { ok: true as const };
}

export async function deleteInventory(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  const inv = await db.inventory.findUnique({ where: { id } });
  if (inv?.status === "draft") {
    await db.inventory.delete({ where: { id } });
    await logAction(user.id, "delete", "inventory", id);
  }
  redirect("/inventory");
}
