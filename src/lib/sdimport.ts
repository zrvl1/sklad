import { db } from "./db";
import { readXlsx } from "./xlsx";
import { getSetting, setSetting } from "./util";

/**
 * Імпорт з Excel-експорту товарів SalesDrive: справжній склад комплектів (колонка «Комплект»: "ID або SKU":к-сть).
 * Спершу — перегляд змін, потім — застосування.
 */
export type SdRow = { sdId: string; sku: string | null; kitRef: string | null; kitQty: number; manufacturer: string | null };

export function parseSdExport(buf: Buffer): SdRow[] {
  const rows = readXlsx(buf);
  const head = rows[0] ?? [];
  const col = (name: string) => head.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const cId = col("ID товару/послуги");
  const cSku = col("SKU");
  const cKit = col("Комплект");
  const cMan = col("Виробник");
  if (cId < 0 || cKit < 0) throw new Error("У файлі немає колонок «ID товару/послуги» і «Комплект» — це має бути експорт товарів SalesDrive");
  const out: SdRow[] = [];
  for (const r of rows.slice(1)) {
    const sdId = (r[cId] ?? "").trim();
    if (!sdId) continue;
    const kit = (r[cKit] ?? "").trim();
    const parts = [...kit.matchAll(/"([^"]+)"\s*:\s*([\d.]+)/g)];
    out.push({
      sdId,
      sku: cSku >= 0 ? (r[cSku] ?? "").trim() || null : null,
      kitRef: parts.length ? parts[0][1] : null,
      kitQty: parts.length ? Number(parts[0][2]) || 1 : 1,
      manufacturer: cMan >= 0 ? (r[cMan] ?? "").trim() || null : null,
    });
  }
  return out;
}

export async function saveImport(rows: SdRow[]) {
  await setSetting("sdImport", JSON.stringify({ at: new Date().toISOString(), rows }));
}

export async function loadImport() {
  const raw = await getSetting("sdImport");
  return raw ? (JSON.parse(raw) as { at: string; rows: SdRow[] }) : null;
}

type Change = { kitId: number; kitName: string; kitSku: string | null; baseId: number | null; baseName: string | null; baseSku: string | null; qty: number; was: string };

/** Що зміниться в прив'язках комплектів */
export async function planKits(rows: SdRow[]) {
  const products = await db.product.findMany({
    where: { deletedAt: null },
    select: { id: true, sdId: true, sku: true, name: true, baseProductId: true, kitQty: true },
  });
  type P = (typeof products)[number];
  const bySd = new Map<string, P>(products.filter((p) => p.sdId).map((p) => [p.sdId!, p]));
  const bySku = new Map<string, P>(products.filter((p) => p.sku).map((p) => [p.sku!.toUpperCase(), p]));
  const byId = new Map<number, P>(products.map((p) => [p.id, p]));
  const inFile = new Set(rows.map((r) => r.sdId));

  const link: Change[] = [];
  const unlink: Change[] = [];
  const problems: string[] = [];
  let same = 0;
  const desired = new Map<number, { baseId: number; qty: number }>();
  for (const r of rows) {
    if (!r.kitRef) continue;
    const kit = bySd.get(r.sdId);
    const base = bySd.get(r.kitRef) ?? bySku.get(r.kitRef.toUpperCase());
    if (!kit) {
      problems.push(`Картки ${r.sku ?? r.sdId} немає в додатку (синхронізуйте товари)`);
      continue;
    }
    if (!base) {
      problems.push(`${r.sku ?? r.sdId}: не знайдено товар-складову «${r.kitRef}»`);
      continue;
    }
    if (base.id === kit.id) continue;
    desired.set(kit.id, { baseId: base.id, qty: r.kitQty });
  }
  // складова, яка сама комплект — у SalesDrive так буває; беремо її основний
  for (const [kitId, d] of desired) {
    const deeper = desired.get(d.baseId);
    if (deeper) desired.set(kitId, { baseId: deeper.baseId, qty: d.qty * deeper.qty });
  }
  for (const [kitId, d] of desired) {
    const k = byId.get(kitId)!;
    const b = byId.get(d.baseId)!;
    if (k.baseProductId === d.baseId && k.kitQty === d.qty) {
      same++;
      continue;
    }
    const old = k.baseProductId ? byId.get(k.baseProductId) : null;
    link.push({
      kitId,
      kitName: k.name,
      kitSku: k.sku,
      baseId: b.id,
      baseName: b.name,
      baseSku: b.sku,
      qty: d.qty,
      was: old ? `був прив'язаний до ${old.sku ?? old.name}` : k.baseProductId === null && products.some((p) => p.baseProductId === k.id) ? "був основним" : "новий",
    });
  }
  for (const p of products) {
    if (!p.baseProductId || !p.sdId || !inFile.has(p.sdId) || desired.has(p.id)) continue;
    const old = byId.get(p.baseProductId);
    unlink.push({ kitId: p.id, kitName: p.name, kitSku: p.sku, baseId: null, baseName: null, baseSku: null, qty: 1, was: `у SalesDrive не комплект (зараз → ${old?.sku ?? "?"})` });
  }
  return { link, unlink, same, problems, desired };
}

/** Застосувати: картки → основні, як у SalesDrive. Комірки карток переносяться на основний товар. */
export async function applyKits(rows: SdRow[]) {
  const { link, unlink, desired } = await planKits(rows);
  const baseIds = new Set([...desired.values()].map((d) => d.baseId));
  await db.$transaction(
    async (tx) => {
      // основні товари не можуть бути картками
      await tx.product.updateMany({ where: { id: { in: [...baseIds] } }, data: { baseProductId: null, kitQty: 1 } });
      for (const u of unlink) await tx.product.update({ where: { id: u.kitId }, data: { baseProductId: null, kitQty: 1 } });
      for (const l of link) {
        await tx.product.update({ where: { id: l.kitId }, data: { baseProductId: l.baseId, kitQty: l.qty, sdKitPending: false } });
        const cells = await tx.productCell.findMany({ where: { productId: l.kitId } });
        for (const c of cells) {
          if (c.qty > 0)
            await tx.productCell.upsert({
              where: { productId_cellId: { productId: l.baseId!, cellId: c.cellId } },
              update: { qty: { increment: c.qty } },
              create: { productId: l.baseId!, cellId: c.cellId, qty: c.qty },
            });
        }
        await tx.productCell.deleteMany({ where: { productId: l.kitId } });
      }
      // картки, що вже є комплектами в SalesDrive, не чекають налаштування
      await tx.product.updateMany({ where: { id: { in: [...desired.keys()] } }, data: { sdKitPending: false } });
    },
    { timeout: 60_000 }
  );
  return { linked: link.length, unlinked: unlink.length };
}
