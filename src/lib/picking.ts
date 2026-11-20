import { ua } from "@/lib/names";
import { mainImage } from "./images";
import { db } from "./db";
import { cachedStatuses, normTtn } from "./orders";
import { getSetting } from "./util";

/**
 * Статуси, у яких заявку треба збирати й пакувати.
 * Якщо в Налаштуваннях збирання нічого не обрано — шукаємо статус «На відправку».
 */
export async function pickStatusIds(): Promise<{ ids: number[]; auto: boolean }> {
  const raw = await getSetting("pickStatuses");
  const saved: number[] = raw ? JSON.parse(raw) : [];
  if (saved.length) return { ids: saved, auto: false };
  const st = await cachedStatuses();
  const auto = st.filter((s) => /на\s*відправ/i.test(s.name)).map((s) => s.id);
  return { ids: auto, auto: true };
}

/** Знайти заявку за відсканованою ТТН або номером заявки */
export async function findOrderByScan(raw: string) {
  const code = normTtn(raw);
  if (!code) return null;
  const byTtn = await db.orderTtn.findUnique({ where: { ttn: code } });
  if (byTtn) return byTtn.orderId;
  // штрихкод наліпки може містити ТТН разом з іншими символами: шукаємо в ньому номер Нової пошти (14 цифр)
  // чи Укрпошти (13 цифр або RR123456789UA)
  const inside = [...(code.match(/\d{14}/g) ?? []), ...(code.match(/\d{13}/g) ?? []), ...(code.match(/[A-Z]{2}\d{9}[A-Z]{2}/g) ?? [])];
  for (const c of inside) {
    const t = await db.orderTtn.findUnique({ where: { ttn: c } });
    if (t) return t.orderId;
  }
  // введено частину номера вручну (останні цифри ТТН)
  if (code.length >= 8 && /^\d+$/.test(code)) {
    const partial = await db.orderTtn.findMany({ where: { ttn: { endsWith: code } }, take: 2 });
    if (partial.length === 1) return partial[0].orderId;
  }
  const n = Number(code);
  if (Number.isInteger(n) && n > 0 && n < 2_000_000_000) {
    const o = await db.sdOrder.findUnique({ where: { id: n }, select: { id: true } });
    if (o) return o.id;
  }
  return null;
}

export type PackLine = {
  key: string;
  productId: number | null;
  name: string;
  sku: string | null;
  qty: number;
  codes: string[]; // усі коди товару: штрихкод, артикул, додаткові — для перевірки сканером
  cells: string[];
  physical: string | null; // для картки-комплекту: який фізичний товар брати (назва й артикул основного)
  labelId: number | null; // товар, наліпку якого друкувати (основний для картки-комплекту)
  image: string | null; // головне фото (картки або основного товару)
};

/** Заявка для екрана пакування: товари з усіма кодами й комірками */
export async function orderForPacking(orderId: number) {
  const o = await db.sdOrder.findUnique({ where: { id: orderId }, include: { lines: true, ttns: true, pack: true } });
  if (!o) return null;
  const ids = o.lines.map((l) => l.productId).filter((x): x is number => x !== null);
  const productInclude = { codes: { select: { code: true } }, cells: { where: { qty: { gt: 0 } }, include: { cell: true } }, kits: { select: { id: true } } } as const;
  const products = await db.product.findMany({
    where: { id: { in: ids } },
    include: { ...productInclude, base: { include: productInclude } },
  });
  const byId = new Map<number, (typeof products)[number]>(products.map((p) => [p.id, p]));
  const merged = new Map<string, PackLine>();
  for (const l of o.lines) {
    const p = l.productId ? byId.get(l.productId) : undefined;
    const key = l.productId ? `p${l.productId}` : `n${l.name}`;
    const prev = merged.get(key);
    if (prev) {
      prev.qty += l.qty;
      continue;
    }
    // картка-комплект: приймаємо і її коди, і наліпку основного товару; комірки — основного
    const b = p?.base;
    const codes = [p?.barcode, p?.sku, p?.sdId, ...(p?.codes.map((c) => c.code) ?? []), l.barcode, l.sku, b?.barcode, b?.sku, b?.sdId, ...(b?.codes.map((c) => c.code) ?? [])]
      .filter((x): x is string => Boolean(x))
      .map((x) => x.trim().toUpperCase());
    merged.set(key, {
      key,
      productId: l.productId,
      name: (p ? ua(p) : l.name) + (!b && p?.manufacturer ? ` [${p.manufacturer}]` : ""),
      sku: p?.sku ?? l.sku,
      qty: l.qty,
      codes: [...new Set(codes)],
      cells: (b ?? p)?.cells.sort((x, y) => y.qty - x.qty).map((c) => c.cell.code) ?? [],
      labelId: (b ?? p)?.id ?? null,
      image: mainImage(p?.images) ?? mainImage(b?.images),
      physical: b ? `${ua(b)}${b.manufacturer ? ` [${b.manufacturer}]` : ""} (${b.sku ?? b.barcode ?? "основний"})` : null,
    });
  }
  const statuses = await cachedStatuses();
  return {
    id: o.id,
    status: statuses.find((s) => s.id === o.statusId)?.name ?? String(o.statusId),
    ttns: o.ttns.map((t) => t.ttn),
    amount: o.amount,
    packed: o.pack ? { at: o.pack.packedAt.toISOString(), by: o.pack.packedBy, checked: o.pack.checked } : null,
    lines: [...merged.values()],
  };
}
