"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { can, requireUser, requirePerm } from "@/lib/auth";
import { internalEan13 } from "@/lib/barcode";
import { addCode, codeOwner, refreshSearch } from "@/lib/codes";
import { isSalesDriveConfigured, parseParams, productToSd, sdUpdateProducts } from "@/lib/salesdrive";
import { applyTemplate } from "@/lib/templates";
import { moneyProblem, validateCodes } from "@/lib/validate";
import { setCellQty } from "@/lib/stock";
import { buildSearch, getSetting, logAction, num, str } from "@/lib/util";
import { getRates, toUah } from "@/lib/currency";

/** Характеристики як стабільний JSON (для порівняння "чи змінилося") */
function normParams(json: string) {
  return JSON.stringify(parseParams(json).filter((x) => x.name.trim()));
}

type PushOpts = { withName?: boolean; withPrice?: boolean; withCost?: boolean; withDetails?: boolean; paramsMode?: "add" | "replace" };
const ALL: PushOpts = { withName: true, withPrice: true, withCost: true };

/** Відправити товар у SalesDrive і записати результат (помилку) у товар */
export async function pushProduct(productId: number, opts: PushOpts) {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId } });
  if (!isSalesDriveConfigured()) return { ok: false, error: "SalesDrive не налаштовано в .env" };
  try {
    await sdUpdateProducts([productToSd(p, null, opts)]);
    await db.product.update({ where: { id: p.id }, data: { syncError: null, syncedAt: new Date() } });
    return { ok: true as const };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.product.update({ where: { id: p.id }, data: { syncError: error } });
    return { ok: false as const, error };
  }
}

/** Наступний вільний артикул за префіксом із Налаштувань, напр. CM0471 */
async function nextSku() {
  const prefix = (await getSetting("skuPrefix")) ?? "ART";
  const digits = Number(await getSetting("skuDigits")) || 4;
  const rows = await db.product.findMany({ where: { sku: { startsWith: prefix } }, select: { sku: true } });
  let max = 0;
  for (const r of rows) {
    const n = Number(r.sku!.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  for (let n = max + 1; ; n++) {
    const sku = prefix + String(n).padStart(digits, "0");
    if (!(await codeOwner(sku))) return sku;
  }
}

/** Призначаємо ID для SalesDrive, штрихкод і артикул, якщо їх немає */
async function finalizeNewProduct(id: number, opts: { genBarcode: boolean; genSku?: boolean }) {
  const p = await db.product.findUniqueOrThrow({ where: { id } });
  const sdId = p.sdId ?? `W${String(id).padStart(6, "0")}`;
  let barcode = p.barcode;
  if (!barcode && opts.genBarcode) {
    barcode = internalEan13(id);
    if (await codeOwner(barcode, id)) barcode = internalEan13(id + 500000000); // вкрай рідкісний збіг — інший діапазон
  }
  const sku = p.sku ?? (opts.genSku ? await nextSku() : null);
  await db.product.update({ where: { id }, data: { sdId, barcode, sku } });
  await refreshSearch(id);
  return db.product.findUniqueOrThrow({ where: { id } });
}

/** Попередження, якщо штрихкод чи артикул уже є в іншого товару */
async function duplicateWarning(productId: number, barcode: string | null, sku: string | null) {
  const msgs: string[] = [];
  for (const [label, code] of [["Штрихкод", barcode], ["Артикул", sku]] as const) {
    if (!code) continue;
    const other = await codeOwner(code, productId);
    if (other) msgs.push(`${label} ${code} також є в товару «${other.name}»`);
  }
  return msgs.join("; ");
}

export async function saveProduct(formData: FormData) {
  const user = await requirePerm("products.edit");
  const id = Number(formData.get("id")) || null;
  const name = str(formData.get("name"));
  if (!name) throw new Error("Вкажіть назву товару");

  const data = {
    name,
    nameForDocuments: str(formData.get("nameForDocuments")),
    categoryName: str(formData.get("categoryName")),
    price: num(formData.get("price")),
    discountValue: num(formData.get("discountValue")) || null,
    discountType: str(formData.get("discountType")) ?? "percent",
    discountFrom: str(formData.get("discountFrom")) ? new Date(String(formData.get("discountFrom"))) : null,
    discountTo: str(formData.get("discountTo")) ? new Date(String(formData.get("discountTo"))) : null,
    sku: str(formData.get("sku")),
    barcode: str(formData.get("barcode")),
    manufacturer: str(formData.get("manufacturer")),
    supplierName: str(formData.get("supplierName")),
    sdId: str(formData.get("sdId")),
    description: str(formData.get("description")),
    params: normParams(String(formData.get("params") ?? "[]")) as string | null,
  };
  // Собівартість: у гривні або у валюті закупівлі (тоді в гривні рахуємо за курсом SalesDrive)
  const costInput = num(formData.get("cost"));
  const costCurrency = str(formData.get("costCurrency")) ?? "UAH";
  const costData =
    costCurrency === "UAH"
      ? { cost: costInput, costCurrency: null, costOriginal: null }
      : { cost: toUah(costInput, costCurrency, await getRates()), costCurrency, costOriginal: costInput };
  const gen = { genBarcode: Boolean(formData.get("genBarcode")), genSku: Boolean(formData.get("genSku")) };

  // Перевірки перед збереженням: дублікати й формат кодів, коректні суми
  // для наявного товару перевіряємо лише змінені коди (старі дублікати з CRM не блокують редагування)
  const prev = id ? await db.product.findUnique({ where: { id }, select: { barcode: true, sku: true } }) : null;
  const errors = [
    ...(await validateCodes({
      id,
      barcode: prev && prev.barcode === data.barcode ? null : data.barcode,
      sku: prev && prev.sku === data.sku ? null : data.sku,
    })),
    moneyProblem("Ціна", data.price),
    moneyProblem("Собівартість", costInput),
    data.discountValue !== null && data.discountType === "percent" && (data.discountValue < 0 || data.discountValue >= 100) ? "Знижка у відсотках має бути від 0 до 99" : null,
    data.discountFrom && data.discountTo && data.discountFrom > data.discountTo ? "Початок знижки пізніше за кінець" : null,
  ].filter(Boolean) as string[];
  if (errors.length) {
    const msg = encodeURIComponent(`Не збережено: ${errors.join("; ")}`);
    redirect(id ? `/products/${id}?warn=${msg}` : `/products/new?err=${msg}`);
  }

  let productId: number;
  let opts: PushOpts = { ...ALL, withDetails: true };
  if (id) {
    const before = await db.product.findUniqueOrThrow({ where: { id } });
    // відправляємо лише те, що змінилося (назва, ціна, собівартість, опис/характеристики)
    const beforeParams = normParams(before.params ?? "[]");
    if (before.description === null && !data.description) data.description = null;
    if (before.params === null && data.params === "[]") data.params = null; // характеристики не завантажені — не чіпаємо
    opts = {
      withName: before.name !== data.name,
      withPrice: before.price !== data.price,
      withDetails: (before.description ?? null) !== data.description || (data.params !== null && beforeParams !== data.params),
      paramsMode: before.params === null ? "add" : "replace",
      withCost: before.cost !== costData.cost || (before.costCurrency ?? null) !== costData.costCurrency || (before.costOriginal ?? null) !== costData.costOriginal,
    };
    await db.product.update({ where: { id }, data: { ...data, ...costData, search: buildSearch(data) } });
    productId = id;
    await finalizeNewProduct(id, gen);
    await logAction(user.id, "update", "product", id, data);
  } else {
    const created = await db.product.create({ data: { ...data, ...costData, search: buildSearch(data) } });
    await finalizeNewProduct(created.id, gen);
    await applyTemplate(created.id); // порожні опис/характеристики/виробник — із шаблону категорії
    productId = created.id;
    await logAction(user.id, "create", "product", created.id, data);
  }

  // Артикул постачальника з форми (необов'язково)
  const supplierCode = str(formData.get("supplierCode"));
  let warn = "";
  if (supplierCode) {
    try {
      await addCode(productId, supplierCode, "supplier", Number(formData.get("supplierCodeSupplierId")) || null);
    } catch (e) {
      warn = e instanceof Error ? e.message : String(e);
    }
  }
  const saved = await db.product.findUniqueOrThrow({ where: { id: productId } });
  warn = [warn, await duplicateWarning(productId, saved.barcode, saved.sku)].filter(Boolean).join("; ");

  const res = await pushProduct(productId, opts);
  // ціна основного товару → на всі його картки-комплекти (якщо не зняли галочку)
  if (opts.withPrice && formData.get("applyKits")) {
    const { propagatePriceToKits } = await import("@/lib/kits");
    const kitErr = await propagatePriceToKits([productId]);
    if (kitErr) warn = [warn, `Ціни карток не оновлено в SalesDrive: ${kitErr}`].filter(Boolean).join("; ");
  }
  revalidatePath("/products");
  redirect(`/products/${productId}?saved=${res.ok ? 1 : 0}${warn ? `&warn=${encodeURIComponent(warn)}` : ""}`);
}

/** Швидке створення товару прямо з документа приходу або інвентаризації */
export async function createProductQuick(input: {
  name: string;
  price: number;
  cost: number;
  costCurrency?: string; // валюта закупівлі (з документа приходу)
  categoryName?: string;
  barcode?: string;
  supplierCode?: string;
  supplierId?: number | null;
  genBarcode?: boolean;
  genSku?: boolean;
}) {
  const user = await requirePerm("products.edit");
  if (!input.name.trim()) return { ok: false as const, error: "Вкажіть назву" };
  const barcode = input.barcode?.trim() || null;
  const { barcodeProblem } = await import("@/lib/validate");
  const bp = barcodeProblem(barcode);
  if (bp) return { ok: false as const, error: bp };
  if (moneyProblem("Ціна", input.price || 0) || moneyProblem("Закупівля", input.cost || 0)) return { ok: false as const, error: "Ціна і закупівля мають бути додатними числами" };
  if (barcode) {
    const other = await codeOwner(barcode);
    if (other) return { ok: false as const, error: `Код ${barcode} вже є в товару «${other.name}»` };
  }
  const cur = input.costCurrency && input.costCurrency !== "UAH" ? input.costCurrency : null;
  const costData = cur
    ? { cost: toUah(input.cost || 0, cur, await getRates()), costCurrency: cur, costOriginal: input.cost || 0 }
    : { cost: input.cost || 0, costCurrency: null, costOriginal: null };
  const data = { name: input.name.trim(), price: input.price || 0, barcode, categoryName: input.categoryName?.trim() || null };
  const created = await db.product.create({ data: { ...data, ...costData, search: buildSearch(data) } });
  await finalizeNewProduct(created.id, { genBarcode: input.genBarcode ?? true, genSku: input.genSku ?? true });
  await applyTemplate(created.id);
  let warning: string | null = null;
  if (input.supplierCode?.trim()) {
    try {
      await addCode(created.id, input.supplierCode, "supplier", input.supplierId ?? null);
    } catch (e) {
      warning = e instanceof Error ? e.message : String(e);
    }
  }
  const p = await db.product.findUniqueOrThrow({ where: { id: created.id } });
  await logAction(user.id, "create", "product", p.id, { ...data, from: "document" });
  const push = await pushProduct(p.id, { ...ALL, withDetails: true });
  if (!push.ok) warning = `Товар збережено, але не відправлено в SalesDrive: ${push.error}`;
  return {
    ok: true as const,
    warning,
    product: { id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, price: p.price, cost: p.cost, sdId: p.sdId },
  };
}

/** Прив'язати відсканований невідомий код до існуючого товару (з приходу/інвентаризації) */
export async function linkCode(input: { productId: number; code: string; type: "supplier" | "barcode"; supplierId: number | null }) {
  const user = await requireUser();
  // прив'язувати коди може той, хто робить прихід/інвентаризацію/списання або редагує товари
  if (!(["products.edit", "receipts", "inventory", "writeoffs"] as const).some((p) => can(user, p)))
    return { ok: false as const, error: "Немає прав прив'язувати коди" };
  try {
    await addCode(input.productId, input.code, input.type, input.supplierId);
    await logAction(user.id, "add-code", "product", input.productId, input);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function addProductCode(formData: FormData) {
  const user = await requirePerm("products.edit");
  const productId = Number(formData.get("productId"));
  const code = String(formData.get("code") ?? "");
  const type = formData.get("type") === "barcode" ? "barcode" : "supplier";
  let msg = "";
  try {
    await addCode(productId, code, type, Number(formData.get("supplierId")) || null);
    await logAction(user.id, "add-code", "product", productId, { code, type });
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}${msg ? `?warn=${encodeURIComponent(msg)}` : ""}`);
}

export async function removeProductCode(formData: FormData) {
  const user = await requirePerm("products.edit");
  const id = Number(formData.get("id"));
  const c = await db.productCode.delete({ where: { id } });
  await refreshSearch(c.productId);
  await logAction(user.id, "remove-code", "product", c.productId, { code: c.code });
  revalidatePath(`/products/${c.productId}`);
}

export async function retryPush(formData: FormData) {
  await requirePerm("products.edit");
  const id = Number(formData.get("id"));
  const p = await db.product.findUniqueOrThrow({ where: { id }, select: { sdId: true } });
  // повтор для товару, створеного в нашому додатку (ID на W…), — з назвою; для товарів із CRM — без
  const res = await pushProduct(id, p.sdId?.startsWith("W") ? { ...ALL, withDetails: true } : {});
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}?saved=${res.ok ? 1 : 0}`);
}

export async function addProductCell(formData: FormData) {
  const user = await requirePerm("cells.edit");
  const productId = Number(formData.get("productId"));
  const cellId = Number(formData.get("cellId"));
  if (!cellId) return;
  await setCellQty({ productId, cellId, qty: num(formData.get("qty")), userId: user.id });
  await logAction(user.id, "assign-cell", "product", productId, { cellId });
  revalidatePath(`/products/${productId}`);
}

export async function removeProductCell(formData: FormData) {
  const user = await requirePerm("cells.edit");
  const productId = Number(formData.get("productId"));
  const cellId = Number(formData.get("cellId"));
  await setCellQty({ productId, cellId, qty: 0, userId: user.id });
  await db.productCell.delete({ where: { productId_cellId: { productId, cellId } } });
  await logAction(user.id, "remove-cell", "product", productId, { cellId });
  revalidatePath(`/products/${productId}`);
}

/**
 * Масово: згенерувати штрихкоди (EAN-13, префікс 200) і/або артикули всім товарам, де їх немає,
 * і відправити в SalesDrive пачками по 100. Лише для адміністратора.
 */
export async function bulkGenerate(formData: FormData) {
  const user = await requirePerm("products.edit");
  const what = String(formData.get("what")); // barcode | sku
  const products = await db.product.findMany({
    // картки-комплекти не потребують своїх кодів для складу — лише основні товари
    where: { deletedAt: null, baseProductId: null, ...(what === "sku" ? { OR: [{ sku: null }, { sku: "" }] } : { OR: [{ barcode: null }, { barcode: "" }] }) },
    select: { id: true },
  });
  for (const p of products) {
    if (what === "sku") await db.product.update({ where: { id: p.id }, data: { sku: null } });
    else await db.product.update({ where: { id: p.id }, data: { barcode: null } });
    await finalizeNewProduct(p.id, { genBarcode: what !== "sku", genSku: what === "sku" });
  }
  let error = "";
  if (products.length && isSalesDriveConfigured()) {
    const full = await db.product.findMany({ where: { id: { in: products.map((p) => p.id) } } });
    try {
      await sdUpdateProducts(full.filter((p) => p.sdId).map((p) => productToSd(p, null, {})));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      await db.product.updateMany({ where: { id: { in: products.map((p) => p.id) } }, data: { syncError: error } });
    }
  }
  await logAction(user.id, `bulk-${what}`, "products", null, { count: products.length, error });
  const label = what === "sku" ? "артикули" : "штрихкоди";
  redirect(
    `/products/codes?msg=${encodeURIComponent(error ? `Помилка відправки в SalesDrive: ${error}` : `Згенеровано ${label}: ${products.length}`)}`
  );
}

export async function saveSkuSettings(formData: FormData) {
  const user = await requirePerm("products.edit");
  const { setSetting } = await import("@/lib/util");
  const prefix = (str(formData.get("prefix")) ?? "ART").toUpperCase().replace(/[^A-ZА-ЯІЇЄҐ0-9-]/g, "");
  const digits = Math.min(8, Math.max(3, Number(formData.get("digits")) || 4));
  await setSetting("skuPrefix", prefix);
  await setSetting("skuDigits", String(digits));
  await logAction(user.id, "sku-settings", "settings", null, { prefix, digits });
  redirect(`/products/codes?msg=${encodeURIComponent(`Шаблон артикула: ${prefix}${"0".repeat(digits - 1)}1`)}`);
}

/**
 * Видалення товарів: у SalesDrive (потрібне право «Товари: видалення») і в додатку.
 * У додатку товар не стирається, а позначається видаленим: історія приходів і продажів зберігається.
 * Кожен видалений товар потрапляє в журнал «Видалені товари» із завданнями для сайтів (Prom, Horoshop…).
 */
export async function deleteProducts(ids: number[], reason: string, force = false) {
  const user = await requirePerm("products.edit");
  if (user.role === "storekeeper") return { ok: false as const, error: "Видаляти товари може лише менеджер або адміністратор" };
  const products = await db.product.findMany({ where: { id: { in: ids }, deletedAt: null }, include: { stocks: true } });
  if (!products.length) return { ok: false as const, error: "Товари не знайдено" };
  // Перевірка: товар із залишком на складі видаляти лише свідомо
  const withStock = products.filter((p) => p.stocks.some((s) => s.qty > 0));
  if (withStock.length && !force) {
    return {
      ok: false as const,
      needForce: true,
      error: `На складі ще є: ${withStock.map((p) => `«${p.name}» — ${p.stocks.reduce((a, s) => a + s.qty, 0)} шт`).join("; ")}. Спишіть залишок або підтвердіть видалення.`,
    };
  }
  const withSd = products.filter((p) => p.sdId);
  if (withSd.length && isSalesDriveConfigured()) {
    try {
      const { sdDeleteProducts } = await import("@/lib/salesdrive");
      await sdDeleteProducts(withSd.map((p) => p.sdId!));
    } catch (e) {
      return {
        ok: false as const,
        error: `SalesDrive не видалив товари: ${e instanceof Error ? e.message : e}. Перевірте, чи в API-ключі ввімкнено «Товари: видалення».`,
      };
    }
  }
  const { recordDeletion } = await import("@/lib/deleted");
  for (const p of products) {
    await db.product.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
    await db.productCell.deleteMany({ where: { productId: p.id } }); // звільняємо комірки
    const { stocks: _s, ...plain } = p;
    await recordDeletion(plain, "app", user.id, reason.trim() || null);
    await logAction(user.id, "delete", "product", p.id, { name: p.name, sdId: p.sdId, reason });
  }
  revalidatePath("/products");
  return { ok: true as const, count: products.length };
}

export async function deleteProductForm(formData: FormData) {
  const r = await deleteProducts([Number(formData.get("id"))], String(formData.get("reason") ?? ""), Boolean(formData.get("force")));
  if (!r.ok) redirect(`/products/${formData.get("id")}?warn=${encodeURIComponent(r.error)}`);
  redirect(`/products/deleted?msg=${encodeURIComponent("Товар видалено. Не забудьте прибрати його на сайтах.")}`);
}

/** Відновити помилково видалений товар: знову створюється в SalesDrive з усіма даними */
export async function restoreProduct(formData: FormData) {
  const user = await requirePerm("products.edit");
  const deletedId = Number(formData.get("deletedId"));
  const d = await db.deletedProduct.findUniqueOrThrow({ where: { id: deletedId } });
  if (!d.productId) redirect(`/products/deleted?msg=${encodeURIComponent("Помилка: немає даних товару для відновлення")}`);
  await db.product.update({ where: { id: d.productId }, data: { deletedAt: null } });
  const res = await pushProduct(d.productId, { ...ALL, withDetails: true });
  await db.deletedProductSite.updateMany({ where: { deletedId, status: "todo" }, data: { status: "skip", doneAt: new Date(), doneBy: user.name } });
  await db.deletedProduct.update({ where: { id: deletedId }, data: { reason: `${d.reason ?? ""} · відновлено ${new Date().toLocaleDateString("uk-UA")}` } });
  await logAction(user.id, "restore", "product", d.productId);
  redirect(`/products/${d.productId}?saved=${res.ok ? 1 : 0}`);
}

/**
 * Масова заміна штрихкодів на нові EAN-13 (префікс 200).
 * Старий штрихкод НЕ губиться: він зберігається як додатковий код товару, тож старі наліпки й далі скануються.
 * scope: all — усім; nonean — лише тим, у кого штрихкод не є правильним EAN-13; empty — лише без штрихкоду.
 */
export async function replaceBarcodes(formData: FormData) {
  const user = await requirePerm("products.edit");
  const scope = String(formData.get("scope"));
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "ЗАМІНИТИ")
    redirect(`/products/codes?msg=${encodeURIComponent("Помилка: для підтвердження впишіть слово ЗАМІНИТИ")}`);
  const { isValidEan13 } = await import("@/lib/barcode");
  // картки-комплекти не чіпаємо: наліпка фізично одна — основного товару
  const all = await db.product.findMany({ where: { deletedAt: null, baseProductId: null }, select: { id: true, barcode: true } });
  const targets = all.filter((p) =>
    scope === "empty" ? !p.barcode : scope === "nonean" ? !p.barcode || !isValidEan13(p.barcode) : true
  );
  const changed: number[] = [];
  for (const p of targets) {
    let code = internalEan13(p.id);
    if (p.barcode === code) continue;
    if (await codeOwner(code, p.id)) code = internalEan13(p.id + 500000000);
    if (p.barcode) {
      try {
        await db.productCode.create({ data: { productId: p.id, code: p.barcode, type: "barcode" } }); // старий — як додатковий
      } catch {
        /* такий код уже збережено */
      }
    }
    await db.product.update({ where: { id: p.id }, data: { barcode: code } });
    await refreshSearch(p.id);
    changed.push(p.id);
  }
  let error = "";
  if (changed.length && isSalesDriveConfigured()) {
    const full = await db.product.findMany({ where: { id: { in: changed } } });
    try {
      await sdUpdateProducts(full.filter((p) => p.sdId).map((p) => productToSd(p, null, {})));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      await db.product.updateMany({ where: { id: { in: changed } }, data: { syncError: error } });
    }
  }
  await logAction(user.id, "replace-barcodes", "products", null, { scope, count: changed.length, error });
  redirect(
    `/products/codes?replaced=${changed.length}&msg=${encodeURIComponent(
      error ? `Помилка відправки в SalesDrive: ${error}` : `Замінено штрихкодів: ${changed.length}. Старі збережено як додаткові коди.`
    )}`
  );
}

/** Прив'язати картку-комплект до основного товару (за кодом основного: артикул/штрихкод/ID) */
export async function linkKitForm(formData: FormData) {
  const user = await requirePerm("products.edit");
  const kitId = Number(formData.get("kitId"));
  const baseCode = String(formData.get("baseCode") ?? "").trim();
  const qty = num(formData.get("kitQty"), 1) || 1;
  const { findByCode } = await import("@/lib/codes");
  const { linkKit } = await import("@/lib/kits");
  const found = (await findByCode(baseCode)).filter((p) => p.id !== kitId);
  let msg = "";
  if (found.length !== 1) msg = found.length ? "Код підходить кільком товарам — уточніть" : `Товар «${baseCode}» не знайдено`;
  else {
    try {
      await linkKit(kitId, found[0].id, qty);
      await logAction(user.id, "link-kit", "product", kitId, { baseId: found[0].id, qty });
      // записуємо склад комплекту і в SalesDrive, щоб CRM теж знала, що це комплект
      const r = await pushKitSet(kitId);
      if (!r.ok) msg = `Прив'язано в додатку, але SalesDrive не прийняв склад комплекту: ${r.error}`;
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
  }
  revalidatePath(`/products/${kitId}`);
  redirect(`/products/${kitId}${msg ? `?warn=${encodeURIComponent(msg)}` : ""}`);
}

export async function unlinkKit(formData: FormData) {
  const user = await requirePerm("products.edit");
  const kitId = Number(formData.get("kitId"));
  const back = String(formData.get("back") ?? `/products/${kitId}`);
  await db.product.update({ where: { id: kitId }, data: { baseProductId: null, kitQty: 1 } });
  await logAction(user.id, "unlink-kit", "product", kitId);
  revalidatePath(back);
  redirect(back.startsWith("/") ? back : "/products");
}

/** Застосувати знайдені за артикулом зв'язки (позначені галочками) */
export async function applyKitLinks(formData: FormData) {
  const user = await requirePerm("products.edit");
  const { linkKit } = await import("@/lib/kits");
  let ok = 0;
  const errors: string[] = [];
  for (const pair of formData.getAll("pair").map(String)) {
    const [kitId, baseId] = pair.split(":").map(Number);
    try {
      await linkKit(kitId, baseId, 1);
      ok++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  await logAction(user.id, "link-kits", "products", null, { ok, errors: errors.length });
  redirect(`/products/kits?msg=${encodeURIComponent(`Прив'язано карток: ${ok}${errors.length ? `. Помилки: ${errors.slice(0, 3).join("; ")}` : ""}`)}`);
}

/**
 * Створити картку для сайту (комплект) з основного товару: інша назва під модель/бренд, свій артикул і ціна.
 * Опис, характеристики, категорія й виробник копіюються з основного — далі їх можна змінити в картці.
 * У SalesDrive картка створюється як комплект із 1 шт основного товару (поле set).
 */
export async function createKitCard(formData: FormData) {
  const user = await requirePerm("products.edit");
  const baseId = Number(formData.get("baseId"));
  const base = await db.product.findUniqueOrThrow({ where: { id: baseId } });
  if (base.baseProductId) redirect(`/products/${baseId}?warn=${encodeURIComponent("Це сама картка-комплект — створюйте картки з основного товару")}`);
  if (!base.sdId) redirect(`/products/${baseId}?warn=${encodeURIComponent("Основний товар ще не в SalesDrive")}`);
  const name = str(formData.get("name"));
  if (!name || name.length < 2) redirect(`/products/${baseId}?warn=${encodeURIComponent("Вкажіть назву картки")}`);

  // артикул: вказаний або наступний вільний «ОСНОВНИЙ-N»
  let sku = str(formData.get("sku"));
  if (!sku && base.sku) {
    for (let n = 1; n < 100; n++) {
      if (!(await codeOwner(`${base.sku}-${n}`))) {
        sku = `${base.sku}-${n}`;
        break;
      }
    }
  }
  const errors = await validateCodes({ sku });
  if (errors.length) redirect(`/products/${baseId}?warn=${encodeURIComponent(errors.join("; "))}`);
  const price = num(formData.get("price"), base.price) || base.price;

  const data = {
    name,
    sku,
    price,
    priceCurrency: base.priceCurrency,
    cost: base.cost,
    categoryName: base.categoryName,
    categorySdId: base.categorySdId,
    manufacturer: base.manufacturer,
    supplierName: base.supplierName,
    description: base.description,
    params: base.params,
    baseProductId: base.id,
    kitQty: 1,
  };
  const created = await db.product.create({ data: { ...data, search: buildSearch(data) } });
  const card = await finalizeNewProduct(created.id, { genBarcode: false, genSku: false });
  let warn = "";
  if (isSalesDriveConfigured()) {
    try {
      await sdUpdateProducts([productToSd(card, null, { withName: true, withPrice: true, withDetails: true, set: [{ id: base.sdId!, quantity: 1 }] })]);
      await db.product.update({ where: { id: card.id }, data: { syncError: null, syncedAt: new Date() } });
    } catch (e) {
      warn = `Картку збережено в додатку, але SalesDrive не прийняв її: ${e instanceof Error ? e.message : e}`;
      await db.product.update({ where: { id: card.id }, data: { syncError: warn } });
    }
  }
  await logAction(user.id, "create-kit-card", "product", card.id, { baseId, name, sku });
  redirect(`/products/${card.id}?saved=${warn ? 0 : 1}${warn ? `&warn=${encodeURIComponent(warn)}` : ""}`);
}

/** Записати склад комплекту в SalesDrive: картка = kitQty шт основного товару (поле set) */
async function pushKitSet(kitId: number) {
  const kit = await db.product.findUniqueOrThrow({ where: { id: kitId }, include: { base: true } });
  if (!kit.base?.sdId) return { ok: false as const, error: "немає основного товару в SalesDrive" };
  if (!isSalesDriveConfigured()) return { ok: false as const, error: "SalesDrive не налаштовано" };
  try {
    await sdUpdateProducts([productToSd(kit, null, { set: [{ id: kit.base.sdId, quantity: kit.kitQty || 1 }] })]);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function pushKitSetForm(formData: FormData) {
  const user = await requirePerm("products.edit");
  const kitId = Number(formData.get("kitId"));
  const r = await pushKitSet(kitId);
  await logAction(user.id, "push-kit-set", "product", kitId, r);
  redirect(`/products/${kitId}?${r.ok ? "saved=1" : `warn=${encodeURIComponent(`SalesDrive не прийняв склад комплекту: ${r.error}`)}`}`);
}
