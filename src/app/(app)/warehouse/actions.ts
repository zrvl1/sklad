"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { findByCode } from "@/lib/codes";
import { moveBetweenCells, setCellQty } from "@/lib/stock";
import { logAction, num } from "@/lib/util";

const back = (path: string, msg: string, ok = true) => {
  revalidatePath(path);
  redirect(`${path}?${ok ? "msg" : "err"}=${encodeURIComponent(msg)}`);
};

/** Сканування товару в комірку: +кількість */
export async function placeByCode(formData: FormData) {
  const user = await requirePerm("cells.edit");
  const cellId = Number(formData.get("cellId"));
  const code = String(formData.get("code") ?? "").trim();
  const qty = num(formData.get("qty"), 1) || 1;
  const path = `/warehouse/cells/${cellId}`;
  if (!code) return back(path, "Відскануйте товар", false);
  const found = await findByCode(code, true);
  if (found.length !== 1) {
    return back(path, found.length ? `Код ${code} підходить кільком товарам — уточніть на картці товару` : `Товар із кодом ${code} не знайдено`, false);
  }
  try {
    await moveBetweenCells({ productId: found[0].id, fromCellId: null, toCellId: cellId, qty, userId: user.id });
  } catch (e) {
    return back(path, e instanceof Error ? e.message : String(e), false);
  }
  await logAction(user.id, "place", "cell", cellId, { productId: found[0].id, qty });
  back(path, `+${qty} «${found[0].name}»`);
}

/** Розмістити нерозкладений товар (зі сторінки складу) */
export async function placeProduct(formData: FormData) {
  const user = await requirePerm("cells.edit");
  const productId = Number(formData.get("productId"));
  const cellId = Number(formData.get("cellId"));
  const qty = num(formData.get("qty"));
  if (!cellId || qty <= 0) return back("/warehouse", "Оберіть комірку і кількість", false);
  await moveBetweenCells({ productId, fromCellId: null, toCellId: cellId, qty, userId: user.id });
  await logAction(user.id, "place", "cell", cellId, { productId, qty });
  back("/warehouse", "Розміщено");
}

export async function moveProduct(formData: FormData) {
  const user = await requirePerm("cells.edit");
  const productId = Number(formData.get("productId"));
  const fromCellId = Number(formData.get("fromCellId"));
  const toCellId = Number(formData.get("toCellId"));
  const qty = num(formData.get("qty"));
  const path = `/warehouse/cells/${fromCellId}`;
  try {
    await moveBetweenCells({ productId, fromCellId, toCellId, qty, userId: user.id });
  } catch (e) {
    return back(path, e instanceof Error ? e.message : String(e), false);
  }
  await logAction(user.id, "move", "cell", fromCellId, { productId, toCellId, qty });
  const to = await db.cell.findUnique({ where: { id: toCellId } });
  back(path, `Переміщено ${qty} шт у ${to?.code ?? "комірку"}`);
}

export async function setQtyInCell(formData: FormData) {
  const user = await requirePerm("cells.edit");
  const productId = Number(formData.get("productId"));
  const cellId = Number(formData.get("cellId"));
  const qty = Math.max(0, num(formData.get("qty")));
  await setCellQty({ productId, cellId, qty, userId: user.id });
  await logAction(user.id, "set-qty", "cell", cellId, { productId, qty });
  back(`/warehouse/cells/${cellId}`, "Кількість оновлено");
}
