"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { MIN_PASSWORD, checkPassword, createSession, hashPassword, requireUser, requirePerm } from "@/lib/auth";
import { syncFromYml } from "@/lib/sync";
import { logAction, str } from "@/lib/util";

const done = (msg: string) => {
  revalidatePath("/settings");
  redirect(`/settings?msg=${encodeURIComponent(msg)}`);
};

export async function syncNow() {
  const user = await requirePerm("sync");
  let message: string;
  try {
    const r = await syncFromYml();
    await logAction(user.id, "sync", "products", null, r);
    message = `Синхронізовано: усього ${r.total}, нових ${r.created}, оновлено ${r.updated}`;
  } catch (e) {
    message = `Помилка синхронізації: ${e instanceof Error ? e.message : e}`;
  }
  done(message);
}

export async function saveWarehouse(formData: FormData) {
  const user = await requirePerm("settings");
  const id = Number(formData.get("id")) || null;
  const name = str(formData.get("name"));
  if (!name) return done("Вкажіть назву складу");
  const data = { name, sdStockId: str(formData.get("sdStockId")), isDefault: Boolean(formData.get("isDefault")) };
  if (data.isDefault) await db.warehouse.updateMany({ data: { isDefault: false } });
  const w = id ? await db.warehouse.update({ where: { id }, data }) : await db.warehouse.create({ data });
  await logAction(user.id, id ? "update" : "create", "warehouse", w.id, data);
  done("Склад збережено");
}

export async function saveSupplier(formData: FormData) {
  const user = await requirePerm("receipts");
  const name = str(formData.get("name"));
  if (!name) return done("Вкажіть назву постачальника");
  const s = await db.supplier.upsert({
    where: { name },
    update: { phone: str(formData.get("phone")) },
    create: { name, phone: str(formData.get("phone")) },
  });
  await logAction(user.id, "save", "supplier", s.id);
  done("Постачальника збережено");
}

/** Масове створення комірок: префікс-стелаж-полиця, напр. A-01-1 … A-05-4 */
export async function generateCells(formData: FormData) {
  const user = await requirePerm("cells.edit");
  const warehouseId = Number(formData.get("warehouseId"));
  const prefix = (str(formData.get("prefix")) ?? "A").toUpperCase();
  const racks = Math.min(200, Math.max(1, Number(formData.get("racks")) || 1));
  const shelves = Math.min(50, Math.max(1, Number(formData.get("shelves")) || 1));
  const codes: string[] = [];
  for (let r = 1; r <= racks; r++)
    for (let s = 1; s <= shelves; s++) codes.push(`${prefix}-${String(r).padStart(2, "0")}-${s}`);

  const existing = new Set(
    (await db.cell.findMany({ where: { warehouseId, code: { in: codes } }, select: { code: true } })).map((c) => c.code)
  );
  const fresh = codes.filter((c) => !existing.has(c));
  if (fresh.length) await db.cell.createMany({ data: fresh.map((code) => ({ code, warehouseId })) });
  await logAction(user.id, "generate", "cells", warehouseId, { prefix, racks, shelves, created: fresh.length });
  done(`Створено комірок: ${fresh.length}${existing.size ? `, вже існували: ${existing.size}` : ""}`);
}

export async function addCell(formData: FormData) {
  const user = await requirePerm("cells.edit");
  const warehouseId = Number(formData.get("warehouseId"));
  const code = str(formData.get("code"))?.toUpperCase();
  if (!code) return done("Вкажіть код комірки");
  await db.cell.upsert({
    where: { warehouseId_code: { warehouseId, code } },
    update: { note: str(formData.get("note")) },
    create: { warehouseId, code, note: str(formData.get("note")) },
  });
  await logAction(user.id, "create", "cell", code);
  done(`Комірку ${code} збережено`);
}

export async function deleteCell(formData: FormData) {
  const user = await requirePerm("settings");
  const id = Number(formData.get("id"));
  await db.cell.delete({ where: { id } });
  await logAction(user.id, "delete", "cell", id);
  done("Комірку видалено");
}

export async function addUser(formData: FormData) {
  const admin = await requirePerm("settings");
  const login = str(formData.get("login"));
  const name = str(formData.get("name"));
  const password = String(formData.get("password") ?? "");
  if (!login || !name || password.length < MIN_PASSWORD) return done(`Логін, ім'я і пароль (${MIN_PASSWORD}+ символів) обов'язкові`);
  if (await db.user.findUnique({ where: { login } })) return done("Такий логін уже є");
  const u = await db.user.create({
    data: {
      login,
      name,
      role: ["admin", "storekeeper", "manager"].includes(String(formData.get("role"))) ? String(formData.get("role")) : "manager",
      passwordHash: hashPassword(password),
    },
  });
  await logAction(admin.id, "create", "user", u.id);
  done(`Користувача ${name} створено`);
}

/** Зміна власного пароля. Усі інші сесії (інші пристрої) після цього розлогінюються. */
export async function changeOwnPassword(formData: FormData) {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!checkPassword(current, user.passwordHash)) return done("Помилка: поточний пароль невірний");
  if (next.length < MIN_PASSWORD) return done(`Помилка: новий пароль має бути ${MIN_PASSWORD}+ символів`);
  if (next !== String(formData.get("repeat") ?? "")) return done("Помилка: паролі не збігаються");
  await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(next), passwordChangedAt: new Date() } });
  await createSession(user.id); // поточний пристрій лишається в системі
  await logAction(user.id, "change-password", "user", user.id);
  done("Пароль змінено. На інших пристроях потрібно увійти заново.");
}

/** Адмін: заблокувати / розблокувати користувача або задати йому новий пароль */
export async function manageUser(formData: FormData) {
  const admin = await requirePerm("settings");
  const id = Number(formData.get("id"));
  const action = String(formData.get("action"));
  if (id === admin.id && action === "disable") return done("Помилка: не можна заблокувати самого себе");
  if (action === "disable" || action === "enable") {
    await db.user.update({ where: { id }, data: { active: action === "enable", passwordChangedAt: new Date() } });
    await logAction(admin.id, action, "user", id);
    return done(action === "enable" ? "Користувача розблоковано" : "Користувача заблоковано, його сесії завершено");
  }
  if (action === "password") {
    const password = String(formData.get("password") ?? "");
    if (password.length < MIN_PASSWORD) return done(`Помилка: пароль має бути ${MIN_PASSWORD}+ символів`);
    await db.user.update({ where: { id }, data: { passwordHash: hashPassword(password), passwordChangedAt: new Date() } });
    await logAction(admin.id, "reset-password", "user", id);
    return done("Пароль користувача змінено");
  }
}
