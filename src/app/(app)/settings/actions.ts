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

/** Метод собівартості при проведенні приходу */
export async function saveCostMethod(formData: FormData) {
  const user = await requirePerm("costs");
  const v = formData.get("costMethod") === "last" ? "last" : "avg";
  await db.setting.upsert({ where: { key: "costMethod" }, update: { value: v }, create: { key: "costMethod", value: v } });
  await logAction(user.id, "cost-method", "settings", null, { costMethod: v });
  done(v === "avg" ? "Собівартість: середньозважена" : "Собівартість: ціна останньої закупівлі");
}

/** Prom: перевірка без відправки — що змінилося б */
export async function promTest() {
  const user = await requirePerm("settings");
  const { promStockSync } = await import("@/lib/prom");
  const { setSetting } = await import("@/lib/util");
  let msg: string;
  try {
    const r = await promStockSync({ dryRun: true });
    await setSetting("promDry", JSON.stringify(r));
    msg = `Prom: товарів ${r.prom}, зіставлено ${r.matched}, не зіставлено ${r.unmatched}, змінилося б ${r.changes}${r.guard ? " — ⚠ запобіжник: забагато «немає в наявності»" : ""}`;
  } catch (e) {
    msg = `Помилка Prom: ${e instanceof Error ? e.message : e}`;
  }
  await logAction(user.id, "prom-test", "settings", null, msg);
  done(msg);
}

/** Prom: відправити зміни зараз */
export async function promRunNow() {
  const user = await requirePerm("settings");
  const { promStockSync } = await import("@/lib/prom");
  let msg: string;
  try {
    const r = await promStockSync();
    msg = r.guard
      ? `⚠ Не відправлено: ${r.changes} змін, з них забагато «немає в наявності» — схоже на збій. Перевірте YML.`
      : `Prom: відправлено ${r.sent} з ${r.changes}${r.errors.length ? `, помилок ${r.errors.length}` : ""}`;
  } catch (e) {
    msg = `Помилка Prom: ${e instanceof Error ? e.message : e}`;
  }
  await logAction(user.id, "prom-run", "settings", null, msg);
  done(msg);
}

/** Prom: увімкнути/вимкнути автоматичне оновлення кожні 5 хвилин */
export async function promToggle(formData: FormData) {
  const user = await requirePerm("settings");
  const { setSetting } = await import("@/lib/util");
  const on = formData.get("on") === "1";
  await setSetting("promEnabled", on ? "1" : "0");
  await logAction(user.id, on ? "prom-on" : "prom-off", "settings", null);
  done(on ? "Автооновлення наявності на Prom увімкнено (кожні 5 хв)" : "Автооновлення Prom вимкнено");
}

/** Prom: знайти дублі (без змін) */
export async function promFindDups() {
  await requirePerm("settings");
  const { findPromDuplicates } = await import("@/lib/prom");
  const { setSetting } = await import("@/lib/util");
  let msg: string;
  try {
    const d = await findPromDuplicates();
    await setSetting("promDups", JSON.stringify(d.slice(0, 30).map((x) => `${x.sku} · ${x.name} (Prom ID ${x.promId})`)));
    msg = d.length ? `Знайдено дублів на Prom: ${d.length}` : "Дублів на Prom не знайдено";
  } catch (e) {
    msg = `Помилка Prom: ${e instanceof Error ? e.message : e}`;
  }
  done(msg);
}

/** Prom: приховати дублі з вітрини */
export async function promHideDups() {
  const user = await requirePerm("settings");
  const { hidePromDuplicates } = await import("@/lib/prom");
  let msg: string;
  try {
    const r = await hidePromDuplicates();
    msg = `Дублі на Prom: знайдено ${r.found}, приховано ${r.hidden}${r.errors.length ? `, помилки: ${r.errors.slice(0, 3).join("; ")}` : ""}`;
  } catch (e) {
    msg = `Помилка Prom: ${e instanceof Error ? e.message : e}`;
  }
  await logAction(user.id, "prom-hide-dups", "settings", null, msg);
  done(msg);
}

/** Prom: українські пошукові запити — тест на 1 товарі / усім / автоматично */
export async function promKw(formData: FormData) {
  const user = await requirePerm("settings");
  const mode = String(formData.get("mode") ?? "test");
  const { setSetting } = await import("@/lib/util");
  if (mode === "auto-on" || mode === "auto-off") {
    await setSetting("promKwAuto", mode === "auto-on" ? "1" : "0");
    done(mode === "auto-on" ? "Українські запити на Prom: автоматично для нових товарів" : "Автозапис українських запитів вимкнено");
  }
  const { promPushUaKeywords } = await import("@/lib/prom");
  let msg: string;
  try {
    const r = await promPushUaKeywords({ test: mode === "test", limit: 500 });
    msg = r.candidates === 0
      ? "Усі товари на Prom уже мають українські пошукові запити"
      : `Українські запити на Prom: записано ${r.sent} з ${r.candidates}${r.sample ? `. Перевірте: ${r.sample}` : ""}${r.errors.length ? `. Помилки: ${r.errors.slice(0, 2).join("; ")}` : ""}`;
  } catch (e) {
    msg = `Помилка Prom: ${e instanceof Error ? e.message : e}`;
  }
  await logAction(user.id, "prom-kw", "settings", null, msg);
  done(msg);
}

/** Секретне посилання на YML для Prom (SalesDrive + українські пошукові запити) */
export async function promFeedKeyAction(formData: FormData) {
  const user = await requirePerm("settings");
  if (user.role !== "admin") done("Лише адміністратор");
  const { setSetting } = await import("@/lib/util");
  const crypto = await import("node:crypto");
  await setSetting("promFeedKey", crypto.randomBytes(24).toString("base64url"));
  await logAction(user.id, "prom-feed-key", "settings", null, String(formData.get("mode") ?? "new"));
  done("Створено нове посилання на фід для Prom. Вставте його в імпорт Prom замість посилання SalesDrive.");
}

export async function saveCustomCategories(formData: FormData) {
  await requirePerm("sync");
  const list = [...new Set(String(formData.get("cats") ?? "").split("\n").map((x) => x.trim()).filter(Boolean))];
  await db.setting.upsert({ where: { key: "customCategories" }, update: { value: JSON.stringify(list) }, create: { key: "customCategories", value: JSON.stringify(list) } });
  revalidatePath("/products/new");
  done(`Збережено категорій: ${list.length}`);
}

/** Назви перенесено в Хорошоп файлом — знімаємо позначку «перейменовано» */
export async function clearRenamed() {
  const user = await requirePerm("products.edit");
  const r = await db.product.updateMany({ where: { nameChangedAt: { not: null } }, data: { nameChangedAt: null } });
  await logAction(user.id, "names-exported", "products", null, { count: r.count });
  return done(`Позначено як перенесені в Хорошоп: ${r.count}. Не забудьте завтра «Підібрати редиректи».`);
}

/** Повторно відправити в SalesDrive фото, завантажені в додаток (раніше йшли в неправильному полі) */
export async function resendOwnPhotos() {
  const user = await requirePerm("sync");
  const { productToSd, sdUpdateProducts, isSalesDriveConfigured } = await import("@/lib/salesdrive");
  if (!isSalesDriveConfigured()) return done("SalesDrive не налаштовано");
  const list = await db.product.findMany({ where: { deletedAt: null, sdId: { not: null }, images: { contains: "/img/" } } });
  let message: string;
  try {
    await sdUpdateProducts(list.map((p) => productToSd(p, null, { withImages: true })));
    await logAction(user.id, "photos-resend", "products", null, { count: list.length });
    message = `Фото відправлено в SalesDrive: товарів ${list.length}`;
  } catch (e) {
    message = `Помилка: ${e instanceof Error ? e.message : e}`;
  }
  done(message);
}
