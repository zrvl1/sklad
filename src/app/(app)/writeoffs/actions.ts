"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isSalesDriveConfigured, productToSd, sdUpdateProducts } from "@/lib/salesdrive";
import { syncFromYml } from "@/lib/sync";
import { logAction } from "@/lib/util";

export type WriteOffLineInput = { productId: number; qty: number; cellId: number | null };

export async function createWriteOff(formData: FormData) {
  const user = await requireUser();
  const warehouseId =
    Number(formData.get("warehouseId")) || (await db.warehouse.findFirst({ where: { isDefault: true } }))?.id || (await db.warehouse.findFirst())?.id;
  if (!warehouseId) throw new Error("Спершу створіть склад");
  const w = await db.writeOff.create({
    data: { number: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, warehouseId, createdById: user.id },
  });
  await db.writeOff.update({ where: { id: w.id }, data: { number: `С-${String(w.id).padStart(6, "0")}` } });
  await logAction(user.id, "create", "writeoff", w.id);
  redirect(`/writeoffs/${w.id}`);
}

export async function saveWriteOff(id: number, input: { reason: string; note: string; lines: WriteOffLineInput[] }) {
  const user = await requireUser();
  const w = await db.writeOff.findUnique({ where: { id } });
  if (!w || w.status !== "draft") return { ok: false as const, error: "Документ уже проведено або не існує" };
  const lines = input.lines.filter((l) => l.productId && l.qty > 0);
  const costs = new Map<number, number>(
    (await db.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } }, select: { id: true, cost: true } })).map((p) => [p.id, p.cost])
  );
  const total = Math.round(lines.reduce((s, l) => s + l.qty * (costs.get(l.productId) ?? 0), 0) * 100) / 100;
  await db.$transaction([
    db.writeOffLine.deleteMany({ where: { writeOffId: id } }),
    db.writeOff.update({
      where: { id },
      data: {
        reason: input.reason || "Інше",
        note: input.note.trim() || null,
        total,
        lines: { create: lines.map((l) => ({ productId: l.productId, qty: l.qty, cellId: l.cellId, cost: costs.get(l.productId) ?? 0 })) },
      },
    }),
  ]);
  await logAction(user.id, "save", "writeoff", id, { lines: lines.length, total });
  return { ok: true as const };
}

/**
 * Проведення списання: свіжі залишки з SalesDrive → новий залишок = поточний − списано →
 * відправка в SalesDrive → зменшення в комірках (вказаній або там, де лежить) → журнал руху.
 */
export async function postWriteOff(id: number) {
  const user = await requireUser();
  const w = await db.writeOff.findUnique({ where: { id }, include: { lines: true, warehouse: true } });
  if (!w) return { ok: false as const, error: "Документ не знайдено" };
  if (w.status !== "draft") return { ok: false as const, error: "Документ уже проведено" };
  if (!w.lines.length) return { ok: false as const, error: "Додайте товари" };

  const sdOn = isSalesDriveConfigured();
  if (sdOn && !w.warehouse.isDefault) return { ok: false as const, error: "Поки що списання проводиться лише для складу за замовчуванням." };
  if (sdOn && process.env.SALESDRIVE_YML_URL) {
    try {
      await syncFromYml();
    } catch (e) {
      return { ok: false as const, error: `Не вдалося оновити залишки з SalesDrive: ${e instanceof Error ? e.message : e}` };
    }
  }

  const qty = new Map<number, number>();
  for (const l of w.lines) qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.qty);
  const ids = [...qty.keys()];
  const [products, stocks] = await Promise.all([
    db.product.findMany({ where: { id: { in: ids } } }),
    db.stockBalance.findMany({ where: { warehouseId: w.warehouseId, productId: { in: ids } } }),
  ]);
  const gone = products.filter((p) => p.deletedAt);
  if (gone.length) return { ok: false as const, error: `Товари видалено, приберіть їх із документа: ${gone.map((p) => p.name).join(", ")}` };
  const cur = new Map<number, number>(stocks.map((s) => [s.productId, s.qty]));
  const short = products.filter((p) => (cur.get(p.id) ?? 0) < (qty.get(p.id) ?? 0) - 1e-9);
  if (short.length) {
    return {
      ok: false as const,
      error: `Недостатньо на складі: ${short.map((p) => `«${p.name}» — є ${cur.get(p.id) ?? 0}, списуєте ${qty.get(p.id)}`).join("; ")}`,
    };
  }

  if (sdOn) {
    try {
      await sdUpdateProducts(products.map((p) => productToSd(p, { sdStockId: w.warehouse.sdStockId, qty: (cur.get(p.id) ?? 0) - (qty.get(p.id) ?? 0) }, {})));
    } catch (e) {
      return { ok: false as const, error: `SalesDrive не прийняв дані, списання не проведено: ${e instanceof Error ? e.message : e}` };
    }
  }

  const now = new Date();
  try {
    await db.$transaction(
      async (tx) => {
        const claimed = await tx.writeOff.updateMany({ where: { id, status: "draft" }, data: { status: "posted", postedAt: now } });
        if (claimed.count === 0) throw new Error("Документ уже проведено");
        for (const p of products) {
          await tx.stockBalance.upsert({
            where: { productId_warehouseId: { productId: p.id, warehouseId: w.warehouseId } },
            update: { qty: (cur.get(p.id) ?? 0) - (qty.get(p.id) ?? 0) },
            create: { productId: p.id, warehouseId: w.warehouseId, qty: 0 },
          });
        }
        for (const l of w.lines) {
          // з якої комірки списуємо: вказаної, інакше — з тих, де лежить (спершу з найменших залишків)
          let left = l.qty;
          const cells = l.cellId
            ? await tx.productCell.findMany({ where: { productId: l.productId, cellId: l.cellId } })
            : await tx.productCell.findMany({ where: { productId: l.productId, qty: { gt: 0 }, cell: { warehouseId: w.warehouseId } }, orderBy: { qty: "asc" } });
          for (const c of cells) {
            if (left <= 1e-9) break;
            const take = Math.min(c.qty, left);
            if (take <= 0) continue;
            await tx.productCell.update({ where: { productId_cellId: { productId: c.productId, cellId: c.cellId } }, data: { qty: { decrement: take } } });
            await tx.stockMove.create({
              data: { productId: l.productId, warehouseId: w.warehouseId, cellId: c.cellId, qty: -take, type: "writeoff", docType: "writeoff", docId: id, userId: user.id, note: w.reason },
            });
            left -= take;
          }
          if (left > 1e-9) {
            await tx.stockMove.create({
              data: { productId: l.productId, warehouseId: w.warehouseId, qty: -left, type: "writeoff", docType: "writeoff", docId: id, userId: user.id, note: `${w.reason} (поза комірками)` },
            });
          }
        }
      },
      { timeout: 60_000, maxWait: 20_000 }
    );
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
  await logAction(user.id, "post", "writeoff", id, { products: products.length, total: w.total, reason: w.reason });
  revalidatePath(`/writeoffs/${id}`);
  revalidatePath("/writeoffs");
  return { ok: true as const };
}

export async function deleteWriteOff(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  const w = await db.writeOff.findUnique({ where: { id } });
  if (w?.status === "draft") {
    await db.writeOff.delete({ where: { id } });
    await logAction(user.id, "delete", "writeoff", id);
  }
  redirect("/writeoffs");
}
