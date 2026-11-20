"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { setKitStocks } from "@/lib/kits";
import { requirePerm } from "@/lib/auth";
import { isSalesDriveConfigured, productToSd, sdUpdateProducts, type SdProductPayload } from "@/lib/salesdrive";
import { syncFromYml } from "@/lib/sync";
import { logAction } from "@/lib/util";
import { propagatePriceToKits } from "@/lib/kits";
import { getRates, refreshRates } from "@/lib/currency";

export type ReceiptInput = {
  date: string;
  warehouseId: number;
  supplierId: number | null;
  invoiceNo: string;
  note: string;
  currency: string; // валюта закупівлі
  lines: { productId: number; qty: number; cost: number; newPrice: number | null; cellId: number | null }[];
};

export async function createReceipt() {
  const user = await requirePerm("receipts");
  const wh = (await db.warehouse.findFirst({ where: { isDefault: true } })) ?? (await db.warehouse.findFirst());
  if (!wh) throw new Error("Спочатку створіть склад у Налаштуваннях");
  const r = await db.receipt.create({
    data: { number: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, warehouseId: wh.id, createdById: user.id },
  });
  await db.receipt.update({ where: { id: r.id }, data: { number: `П-${String(r.id).padStart(6, "0")}` } });
  await logAction(user.id, "create", "receipt", r.id);
  redirect(`/receipts/${r.id}`);
}

export async function saveReceipt(id: number, input: ReceiptInput) {
  const user = await requirePerm("receipts");
  const r = await db.receipt.findUnique({ where: { id } });
  if (!r) return { ok: false as const, error: "Документ не знайдено" };
  if (r.status !== "draft") return { ok: false as const, error: "Проведений документ змінювати не можна" };

  if (input.lines.some((l) => !Number.isFinite(l.qty) || !Number.isFinite(l.cost) || l.cost < 0 || (l.newPrice !== null && l.newPrice < 0)))
    return { ok: false as const, error: "Кількість, закупівля і ціна мають бути додатними числами" };
  // картки-комплекти → основний товар (закупівля перераховується на одиницю основного)
  const kitInfo = new Map<number, { baseProductId: number | null; kitQty: number }>(
    (await db.product.findMany({ where: { id: { in: input.lines.map((l) => l.productId) }, baseProductId: { not: null } }, select: { id: true, baseProductId: true, kitQty: true } })).map(
      (p) => [p.id, p]
    )
  );
  const lines = input.lines
    .filter((l) => l.productId && l.qty > 0)
    .map((l) => {
      const k = kitInfo.get(l.productId);
      const q = k?.kitQty || 1;
      return k?.baseProductId ? { ...l, productId: k.baseProductId, qty: l.qty * q, cost: l.cost / q } : l;
    });
  const currency = (input.currency || "UAH").toUpperCase();
  const rate = currency === "UAH" ? 1 : (await getRates())[currency];
  if (!rate) return { ok: false as const, error: `Немає курсу для ${currency}. Перевірте валюти в SalesDrive.` };
  const totalCurrency = Math.round(lines.reduce((s, l) => s + l.qty * l.cost, 0) * 100) / 100;
  const total = Math.round(totalCurrency * rate * 100) / 100;

  await db.$transaction([
    db.receiptLine.deleteMany({ where: { receiptId: id } }),
    db.receipt.update({
      where: { id },
      data: {
        date: input.date ? new Date(input.date) : new Date(),
        warehouseId: input.warehouseId,
        supplierId: input.supplierId,
        invoiceNo: input.invoiceNo.trim() || null,
        note: input.note.trim() || null,
        currency,
        rate,
        total,
        totalCurrency,
        lines: { create: lines.map((l) => ({ productId: l.productId, qty: l.qty, cost: l.cost, newPrice: l.newPrice, cellId: l.cellId })) },
      },
    }),
  ]);
  await logAction(user.id, "save", "receipt", id, { lines: lines.length, total });
  revalidatePath(`/receipts/${id}`);
  return { ok: true as const };
}

/**
 * Проведення приходу:
 * 1) оновлюємо залишки з SalesDrive (YML), щоб рахувати від свіжих даних;
 * 2) рахуємо новий залишок = поточний + прихід;
 * 3) відправляємо в SalesDrive залишок, собівартість (і нову ціну, якщо вказана);
 * 4) лише після успіху фіксуємо у нашій базі (залишки, комірки, статус документа).
 */
export async function postReceipt(id: number) {
  const user = await requirePerm("receipts");
  const r = await db.receipt.findUnique({ where: { id }, include: { lines: true, warehouse: true, supplier: true } });
  if (!r) return { ok: false as const, error: "Документ не знайдено" };
  if (r.status !== "draft") return { ok: false as const, error: "Документ уже проведено" };
  if (r.lines.length === 0) return { ok: false as const, error: "Додайте хоча б один товар" };

  const sdOn = isSalesDriveConfigured();
  if (sdOn && !r.warehouse.isDefault) {
    return {
      ok: false as const,
      error:
        "Поки що проведення працює лише для складу за замовчуванням: YML віддає загальний залишок, тому для інших складів ми не знаємо поточну кількість і могли б її затерти.",
    };
  }

  if (sdOn && process.env.SALESDRIVE_YML_URL) {
    try {
      await syncFromYml();
    } catch (e) {
      return { ok: false as const, error: `Не вдалося оновити залишки з SalesDrive перед проведенням: ${e instanceof Error ? e.message : e}` };
    }
  }

  // Свіжий курс із SalesDrive на момент проведення
  let rate = 1;
  if (r.currency !== "UAH") {
    try {
      if (sdOn) await refreshRates();
    } catch {
      /* використаємо курс із кешу */
    }
    rate = (await getRates())[r.currency] ?? r.rate;
  }

  // Згортаємо однакові товари в один рядок
  // (ціна закупівлі одного товару в кількох рядках — середньозважена)
  const agg = new Map<number, { qty: number; cost: number; newPrice: number | null }>();
  for (const l of r.lines) {
    const a = agg.get(l.productId) ?? { qty: 0, cost: l.cost, newPrice: null };
    a.cost = a.qty + l.qty > 0 ? (a.cost * a.qty + l.cost * l.qty) / (a.qty + l.qty) : l.cost;
    a.qty += l.qty;
    if (l.newPrice !== null && l.newPrice > 0) a.newPrice = l.newPrice;
    agg.set(l.productId, a);
  }
  const ids = [...agg.keys()];
  const [products, stocks] = await Promise.all([
    db.product.findMany({ where: { id: { in: ids } } }),
    db.stockBalance.findMany({ where: { warehouseId: r.warehouseId, productId: { in: ids } } }),
  ]);
  const gone = products.filter((p) => p.deletedAt);
  if (gone.length) return { ok: false as const, error: `Товари видалено, приберіть їх із документа: ${gone.map((p) => p.name).join(", ")}` };
  // залишок пишемо лише основним товарам: картка-комплект у документі (стара чернетка) — зупиняємось
  const kitLines = products.filter((p) => p.baseProductId);
  if (kitLines.length)
    return { ok: false as const, error: `У документі є картки-комплекти (${kitLines.map((p) => p.sku ?? p.name).join(", ")}). Натисніть «Зберегти» — вони заміняться основним товаром.` };
  const curQty = new Map<number, number>(stocks.map((s) => [s.productId, s.qty]));
  // Метод собівартості: avg — середньозважена (старий залишок за старою ціною + новий за новою), last — ціна останньої закупівлі
  const costMethod = ((await db.setting.findUnique({ where: { key: "costMethod" } }))?.value ?? "avg") as "avg" | "last";

  const plan = products.map((p) => {
    const a = agg.get(p.id)!;
    const old = Math.max(0, curQty.get(p.id) ?? 0);
    // у валюті документа: старий залишок рахуємо у валюті лише якщо собівартість товару вже в цій валюті
    const oldCost = r.currency === "UAH" ? p.cost : p.costCurrency === r.currency ? p.costOriginal : null;
    const unit =
      costMethod === "avg" && old > 0 && oldCost !== null && oldCost > 0 ? (old * oldCost + a.qty * a.cost) / (old + a.qty) : a.cost;
    a.cost = Math.round(unit * 100) / 100;
    return {
      // собівартість: у валюті приходу (SalesDrive сам перерахує в гривню) + у гривні для наших звітів
      product: {
        ...p,
        cost: Math.round(a.cost * rate * 100) / 100,
        costCurrency: r.currency === "UAH" ? null : r.currency,
        costOriginal: r.currency === "UAH" ? null : a.cost,
        // нова ціна продажу вводиться в гривні
        price: a.newPrice ?? p.price,
        priceCurrency: a.newPrice ? "UAH" : p.priceCurrency,
        // постачальник товару — з приходу (останній, у кого купили)
        supplierName: r.supplier?.name ?? p.supplierName,
      },
      withPrice: a.newPrice !== null,
      newQty: (curQty.get(p.id) ?? 0) + a.qty,
    };
  });

  let warning: string | null = null;
  if (sdOn) {
    let payloads: SdProductPayload[];
    try {
      payloads = plan.map((x) => productToSd(x.product, { sdStockId: r.warehouse.sdStockId, qty: x.newQty }, { withCost: true, withPrice: x.withPrice }));
      await sdUpdateProducts(payloads);
    } catch (e) {
      return { ok: false as const, error: `SalesDrive не прийняв дані, документ не проведено: ${e instanceof Error ? e.message : e}` };
    }
  } else {
    warning = "SalesDrive не налаштовано — прихід проведено лише в нашій базі.";
  }

  const now = new Date();
  try {
  await db.$transaction(async (tx) => {
    // Захист від подвійного натискання: документ переводимо в "проведено" лише якщо він ще чернетка
    const claimed = await tx.receipt.updateMany({
      where: { id, status: "draft" },
      data: { status: "posted", postedAt: now, postedById: user.id, rate, total: Math.round(r.totalCurrency * rate * 100) / 100 },
    });
    if (claimed.count === 0) throw new Error("Документ уже проведено");
    for (const x of plan) {
      await tx.stockBalance.upsert({
        where: { productId_warehouseId: { productId: x.product.id, warehouseId: r.warehouseId } },
        update: { qty: x.newQty },
        create: { productId: x.product.id, warehouseId: r.warehouseId, qty: x.newQty },
      });
      await setKitStocks(tx, x.product.id, r.warehouseId, x.newQty);
      await tx.product.update({
        where: { id: x.product.id },
        data: {
          cost: x.product.cost,
          costCurrency: x.product.costCurrency,
          costOriginal: x.product.costOriginal,
          price: x.product.price,
          priceCurrency: x.product.priceCurrency,
          supplierName: x.product.supplierName,
          ...(sdOn ? { syncError: null, syncedAt: now } : {}),
        },
      });
    }
    for (const l of r.lines) {
      await tx.stockMove.create({
        data: { productId: l.productId, warehouseId: r.warehouseId, cellId: l.cellId, qty: l.qty, type: "receipt", docType: "receipt", docId: id, userId: user.id },
      });
      if (!l.cellId) continue;
      await tx.productCell.upsert({
        where: { productId_cellId: { productId: l.productId, cellId: l.cellId } },
        update: { qty: { increment: l.qty } },
        create: { productId: l.productId, cellId: l.cellId, qty: l.qty },
      });
    }
  }, { timeout: 60_000, maxWait: 20_000 });
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }

  // нова ціна основного товару — на всі його картки-комплекти
  const kitErr = await propagatePriceToKits(plan.filter((x) => x.withPrice).map((x) => x.product.id));
  if (kitErr) warning = [warning, `Ціни карток-комплектів не оновлено в SalesDrive: ${kitErr}`].filter(Boolean).join(" ");
  await logAction(user.id, "post", "receipt", id, { products: plan.length, total: r.total });
  revalidatePath(`/receipts/${id}`);
  revalidatePath("/receipts");
  return { ok: true as const, warning };
}

export async function deleteReceipt(formData: FormData) {
  const user = await requirePerm("receipts");
  const id = Number(formData.get("id"));
  const r = await db.receipt.findUnique({ where: { id } });
  if (r?.status === "draft") {
    await db.receipt.delete({ where: { id } });
    await logAction(user.id, "delete", "receipt", id);
  }
  redirect("/receipts");
}
