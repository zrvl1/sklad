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
import { buildSearch, getSetting, logAction, num, setSetting, str } from "@/lib/util";
import { getRates, toUah } from "@/lib/currency";
import { nextSku } from "@/lib/nextcodes";
import { appSdId, isAppSdId } from "@/lib/sdid";
import { PATH_SEP, categoryIdFor, createCategory, findCategory } from "@/lib/categories";

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
    // перша успішна передача (або повтор після помилки) — повністю, разом з назвою й фото
    const first = !p.syncedAt;
    const full = { ...ALL, withDetails: true, withImages: true };
    try {
      await sdUpdateProducts([productToSd(p, null, first ? { ...opts, ...full } : opts)]);
    } catch (e) {
      // SalesDrive не знайшов товар (вважає його новим і вимагає назву) — відправляємо повністю
      if (!(e instanceof Error && /required field/i.test(e.message))) throw e;
      await sdUpdateProducts([productToSd(p, null, { ...opts, ...full })]);
    }
    await db.product.update({ where: { id: p.id }, data: { syncError: null, syncedAt: new Date() } });
    return { ok: true as const };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.product.update({ where: { id: p.id }, data: { syncError: error } });
    return { ok: false as const, error };
  }
}

/** Призначаємо ID для SalesDrive, штрихкод і артикул, якщо їх немає */
async function finalizeNewProduct(id: number, opts: { genBarcode: boolean; genSku?: boolean }) {
  const p = await db.product.findUniqueOrThrow({ where: { id } });
  // ID для SalesDrive — числовий, як у SalesDrive (10 цифр, починається з 9, щоб не збігся з їхніми)
  const sdId = p.sdId ?? appSdId(id);
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
    nameTranslate: str(formData.get("nameTranslate")),
    nameForDocuments: str(formData.get("nameForDocuments")),
    categoryName: str(formData.get("categoryName")) as string | null,
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
    descriptionTranslate: str(formData.get("descriptionTranslate")),
    keywords: str(formData.get("keywords")),
    keywordsUa: str(formData.get("keywordsUa")),
    country: str(formData.get("country")),
    params: normParams(String(formData.get("params") ?? "[]")) as string | null,
    categorySdId: null as string | null,
  };
  // Категорія: наявна в SalesDrive (за шляхом/назвою) або нова — створюємо її в SalesDrive
  const catInput = str(formData.get("categoryPath"));
  if (formData.has("categoryPath")) {
    const found = await findCategory(catInput);
    if (found) {
      data.categoryName = found.name;
      data.categorySdId = found.id;
    } else if (catInput) {
      const leaf = catInput.split(PATH_SEP).pop()!.trim();
      const known = await categoryIdFor(leaf);
      if (known) {
        data.categoryName = leaf;
        data.categorySdId = known;
      } else {
        try {
          const c = await createCategory(leaf, str(formData.get("categoryParent")));
          data.categoryName = c.name;
          data.categorySdId = c.id;
        } catch {
          data.categoryName = leaf; // не вдалося створити — передасться за назвою
        }
      }
    } else data.categoryName = null;
  } else {
    data.categorySdId = await categoryIdFor(data.categoryName);
  }
  // Новий товар: порожня українська версія перекладається автоматично (DeepL; ключові слова без DeepL — за словником).
  // В наявних товарах не чіпаємо: українська назва з SalesDrive може не приходити в YML, і ми б її затерли.
  if (!id) {
    const { translate, translateConfigured } = await import("@/lib/translate");
    const { translateKeywords } = await import("@/lib/ruua");
    if (translateConfigured()) {
      try {
        const need = [!data.nameTranslate ? name : "", !data.descriptionTranslate && data.description ? data.description : "", !data.keywordsUa && data.keywords ? data.keywords : ""];
        if (need.some(Boolean)) {
          const [n] = need[0] ? await translate([need[0]], "RU", "UK") : [""];
          const [d] = need[1] ? await translate([need[1]], "RU", "UK", true) : [""];
          const [k] = need[2] ? await translate([need[2]], "RU", "UK") : [""];
          if (n) data.nameTranslate = n;
          if (d) data.descriptionTranslate = d;
          if (k) data.keywordsUa = k;
        }
      } catch {
        /* перекладач недоступний — збережемо як є */
      }
    } else if (!data.keywordsUa && data.keywords) data.keywordsUa = translateKeywords(data.keywords);
  }
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
    if (before.descriptionTranslate === null && !data.descriptionTranslate) data.descriptionTranslate = null;
    // ключові слова й країна з YML можуть не приходити — не затираємо їх порожнім полем форми
    if (!data.keywords && before.keywords) data.keywords = before.keywords;
    if (!data.keywordsUa && before.keywordsUa) data.keywordsUa = before.keywordsUa;
    if (!data.country && before.country) data.country = before.country;
    if (before.params === null && data.params === "[]") data.params = null; // характеристики не завантажені — не чіпаємо
    opts = {
      withName: before.name !== data.name || (before.nameTranslate ?? null) !== data.nameTranslate,
      withPrice: before.price !== data.price,
      withDetails:
        (before.description ?? null) !== data.description ||
        (before.descriptionTranslate ?? null) !== data.descriptionTranslate ||
        (before.keywords ?? null) !== data.keywords ||
        (before.keywordsUa ?? null) !== data.keywordsUa || (data.params !== null && beforeParams !== data.params),
      paramsMode: before.params === null ? "add" : "replace",
      withCost: before.cost !== costData.cost || (before.costCurrency ?? null) !== costData.costCurrency || (before.costOriginal ?? null) !== costData.costOriginal,
    };
    await db.product.update({ where: { id }, data: { ...data, ...costData, textEditedAt: new Date(), search: buildSearch(data) } });
    productId = id;
    await finalizeNewProduct(id, gen);
    await logAction(user.id, "update", "product", id, data);
  } else {
    const created = await db.product.create({ data: { ...data, ...costData, search: buildSearch(data) } });
    await finalizeNewProduct(created.id, gen);
    await applyTemplate(created.id); // порожні опис/характеристики/виробник — із шаблону категорії
    productId = created.id;
    await logAction(user.id, "create", "product", created.id, data);
    // фото з форми нового товару — зберігаємо до першої передачі, щоб пішли в SalesDrive разом із товаром
    const photos = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0 && /^image\/(jpeg|png|webp)$/.test(f.type)).slice(0, 8);
    if (photos.length) {
      const { ownImageUrl, warmImages } = await import("@/lib/images");
      const urls: string[] = [];
      for (const f of photos) {
        const img = await db.productImage.create({ data: { productId, mime: f.type, data: Buffer.from(await f.arrayBuffer()) } });
        urls.push(ownImageUrl(img.id));
      }
      await db.product.update({ where: { id: productId }, data: { images: JSON.stringify(urls) } });
      await warmImages(urls);
    }
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
  const q = `saved=${res.ok ? 1 : 0}${warn ? `&warn=${encodeURIComponent(warn)}` : ""}`;
  if (!id && formData.get("thenCards")) redirect(`/products/${productId}/cards?${q}`);
  redirect(`/products/${productId}?${q}`);
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
  const catName = input.categoryName?.trim() || null;
  const data = { name: input.name.trim(), price: input.price || 0, barcode, categoryName: catName, categorySdId: await categoryIdFor(catName) };
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
  const res = await pushProduct(id, isAppSdId(p.sdId) ? { ...ALL, withDetails: true } : {});
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
      // API SalesDrive не має поля складу комплекту — комплект налаштовується в самій CRM (галочка «Комплект»)
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

/** Зробити картку основним (фізичним) товаром групи комплектів */
export async function makeBaseForm(formData: FormData) {
  const user = await requirePerm("products.edit");
  const kitId = Number(formData.get("kitId"));
  const back = String(formData.get("back") ?? `/products/${kitId}`);
  const { makeBase } = await import("@/lib/kits");
  let msg = "Тепер це основний товар групи";
  try {
    await makeBase(kitId);
    await logAction(user.id, "make-base", "product", kitId);
  } catch (e) {
    msg = `Помилка: ${e instanceof Error ? e.message : e}`;
  }
  revalidatePath("/products/kits");
  redirect(`${back.startsWith("/") ? back : `/products/${kitId}`}?${msg.startsWith("Помилка") ? "warn" : "msg"}=${encodeURIComponent(msg)}`);
}

/**
 * Створити картки-комплекти основного товару (вітрини під різні моделі).
 * Картки йдуть у SalesDrive як звичайні товари; у CRM їх ще треба позначити «Комплект» і додати основний —
 * API SalesDrive склад комплекту не приймає. До того вони висять у списку «Налаштувати в SalesDrive».
 */
export async function createKitCards(formData: FormData) {
  const user = await requirePerm("products.edit");
  const baseId = Number(formData.get("baseId"));
  const base = await db.product.findUniqueOrThrow({ where: { id: baseId } });
  const back = (m: string) => redirect(`/products/${baseId}/cards?err=${encodeURIComponent(m)}`);
  if (base.baseProductId) back("Цей товар сам є карткою — створюйте картки від основного");
  if (base.deletedAt) back("Товар видалено");
  if (!base.sku) back("Задайте основному товару артикул — від нього утворяться артикули карток (АРТИКУЛ-1, -2…)");

  type Row = { name: string; nameTranslate: string | null; price: number; qty: number; description: string | null; descriptionTranslate: string | null; extra: string };
  const rows: Row[] = [];
  const count = Number(formData.get("count")) || 0;
  for (let i = 0; i < count; i++) {
    const name = str(formData.get(`name_${i}`));
    if (!name) continue;
    rows.push({
      name,
      nameTranslate: str(formData.get(`nameTr_${i}`)),
      price: num(formData.get(`price_${i}`)),
      qty: Math.max(1, num(formData.get(`qty_${i}`), 1)),
      description: str(formData.get(`desc_${i}`)),
      descriptionTranslate: str(formData.get(`descTr_${i}`)),
      extra: String(formData.get(`extra_${i}`) ?? ""),
    });
  }
  if (!rows.length) back("Додайте хоча б одну картку з назвою");
  const problems = rows.map((r) => moneyProblem(`Ціна «${r.name}»`, r.price)).filter(Boolean);
  if (problems.length) back(problems.join("; "));
  const names = new Set<string>();
  for (const r of rows) {
    if (names.has(r.name.toLowerCase())) back(`Назва повторюється: «${r.name}»`);
    names.add(r.name.toLowerCase());
  }

  const { nextKitSkus } = await import("@/lib/kits");
  const skus = await nextKitSkus(base.sku!, rows.length);
  const baseParams = parseParams(base.params).filter((x) => x.name.trim() && x.value.trim());
  const created: number[] = [];
  for (const [i, r] of rows.entries()) {
    // характеристики основного + додаткові для цієї картки («Назва: значення», кожна з нового рядка; однакова назва — замінює)
    const params = baseParams.map((x) => ({ ...x }));
    for (const line of r.extra.split(/\r?\n/)) {
      const at = line.indexOf(":");
      if (at < 1) continue;
      const pname = line.slice(0, at).trim();
      const value = line.slice(at + 1).trim();
      if (!pname || !value) continue;
      const ex = params.find((x) => x.name.toLowerCase() === pname.toLowerCase());
      if (ex) ex.value = value;
      else params.push({ name: pname, type: "text", value });
    }
    const data = {
      name: r.name,
      nameTranslate: r.nameTranslate,
      price: r.price,
      priceCurrency: base.priceCurrency,
      cost: Math.round(base.cost * r.qty * 100) / 100, // лише для звітів додатку; у SalesDrive собівартість комплекту рахує CRM
      categorySdId: base.categorySdId,
      categoryName: base.categoryName,
      manufacturer: base.manufacturer,
      country: base.country,
      keywords: base.keywords ? `${r.name}, ${base.keywords}` : r.name,
      keywordsUa: base.keywordsUa ? `${r.nameTranslate ?? r.name}, ${base.keywordsUa}` : null,
      supplierName: base.supplierName,
      description: r.description,
      descriptionTranslate: r.descriptionTranslate,
      params: JSON.stringify(params),
      sku: skus[i],
      baseProductId: base.id,
      kitQty: r.qty,
      sdKitPending: true,
    };
    const p = await db.product.create({ data: { ...data, search: buildSearch(data) } });
    await finalizeNewProduct(p.id, { genBarcode: true });
    created.push(p.id);
  }
  await logAction(user.id, "create-kit-cards", "product", base.id, { cards: created });

  let warn = "";
  if (isSalesDriveConfigured()) {
    const full = await db.product.findMany({ where: { id: { in: created } } });
    try {
      await sdUpdateProducts(full.map((p) => productToSd(p, null, { withName: true, withPrice: true, withDetails: true, paramsMode: "replace" })));
      await db.product.updateMany({ where: { id: { in: created } }, data: { syncError: null, syncedAt: new Date() } });
    } catch (e) {
      warn = e instanceof Error ? e.message : String(e);
      await db.product.updateMany({ where: { id: { in: created } }, data: { syncError: warn } });
    }
  } else warn = "SalesDrive не налаштовано — картки збережено лише в додатку";
  revalidatePath("/products");
  revalidatePath("/products/kits");
  const msg = `Створено карток: ${created.length} (${skus.join(", ")}). Тепер у SalesDrive позначте кожну «Комплект» і додайте основний ${base.sku}.`;
  redirect(`/products/kits?msg=${encodeURIComponent(msg)}${warn ? `&warn=${encodeURIComponent(`Не відправлено в SalesDrive: ${warn}`)}` : ""}#pending`);
}

/** Картку позначено комплектом у SalesDrive вручну */
export async function confirmKitSd(formData: FormData) {
  await requirePerm("products.edit");
  const ids = formData.getAll("kitId").map(Number).filter(Boolean);
  if (ids.length) await db.product.updateMany({ where: { id: { in: ids } }, data: { sdKitPending: false } });
  const back = String(formData.get("back") ?? "/products/kits");
  revalidatePath("/products/kits");
  redirect(back.startsWith("/") ? back : "/products/kits");
}

/**
 * Перевірити товар у YML SalesDrive і одразу оновити з нього назви, описи, фото, ключові слова.
 * Показує, що саме SalesDrive віддає в тегах name / name_ua / description / description_ua.
 */
export async function checkFromYml(formData: FormData) {
  await requirePerm("products.edit");
  const id = Number(formData.get("id"));
  const p = await db.product.findUniqueOrThrow({ where: { id } });
  const { fetchYmlText } = await import("@/lib/salesdrive");
  const xml = await fetchYmlText();
  // сирий фрагмент offer — щоб бачити теги як є
  const start = p.sdId ? xml.indexOf(`<offer id="${p.sdId}"`) : -1;
  const raw = start >= 0 ? xml.slice(start, xml.indexOf("</offer>", start) + 8) : "";
  const tag = (t: string) => {
    const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(raw);
    return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : null;
  };
  const found = {
    name: tag("name"),
    name_ua: tag("name_ua"),
    description: tag("description")?.slice(0, 300) ?? null,
    description_ua: tag("description_ua")?.slice(0, 300) ?? null,
    keywords: tag("keywords"),
    keywords_ua: tag("keywords_ua"),
    // усі назви тегів цього товару — щоб бачити, як SalesDrive називає українські поля
    tags: [...new Set([...raw.matchAll(/<([a-z_]+)[\s>]/gi)].map((m) => m[1]))].join(", "),
  };
  if (raw) {
    const full = { description: tag("description"), description_ua: tag("description_ua") };
    await db.product.update({
      where: { id },
      data: {
        ...(found.name ? { name: found.name } : {}),
        ...(found.name_ua ? { nameTranslate: found.name_ua } : {}),
        ...(full.description !== null ? { description: full.description } : {}),
        ...(full.description_ua !== null ? { descriptionTranslate: full.description_ua } : {}),
        ...(found.keywords !== null ? { keywords: found.keywords } : {}),
      },
    });
  }
  await setSetting(`ymlCheck:${id}`, JSON.stringify({ at: new Date().toISOString(), inYml: Boolean(raw), ...found }));
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}#yml`);
}

/** Prom: перевірити товар (пошукові запити обома мовами) або записати українські запити саме для нього */
export async function promProductForm(formData: FormData) {
  const user = await requirePerm("products.edit");
  const id = Number(formData.get("id"));
  const mode = String(formData.get("mode") ?? "check");
  const p = await db.product.findUniqueOrThrow({ where: { id } });
  const { promConfigured, promProductInfo, promPushUaKeywords, promRestoreRuKeywords } = await import("@/lib/prom");
  let result: Record<string, unknown>;
  try {
    if (!promConfigured()) throw new Error("Немає PROM_API_TOKEN у Vercel");
    let pushed: string | null = null;
    if (mode === "restore-ru") {
      if (!p.keywords?.trim()) throw new Error("У товару немає російських ключових слів");
      const info0 = await promProductInfo(p.sdId, p.sku);
      if (!info0) throw new Error("Товару немає на Prom");
      await promRestoreRuKeywords(info0.promId, p.keywords);
      pushed = "російські запити повернуто з SalesDrive";
      await logAction(user.id, "prom-kw", "product", id, pushed);
    }
    if (mode === "push") {
      if (!p.sdId) throw new Error("Товар ще не в SalesDrive");
      if (!p.keywords?.trim() && !p.keywordsUa?.trim()) throw new Error("У товару немає ключових слів — заповніть їх у формі нижче");
      await promProductInfo(p.sdId, p.sku); // переконатись, що товар є в списку Prom
      const r = await promPushUaKeywords({ sdIds: [p.sdId], onlyMissing: false, limit: 1 });
      if (r.errors.length) throw new Error(r.errors.join("; "));
      pushed = r.sent ? "записано" : "товар не знайдено на Prom";
      await logAction(user.id, "prom-kw", "product", id, pushed);
    }
    const info = await promProductInfo(p.sdId, p.sku);
    result = info ? { ok: true, pushed, ...info } : { ok: false, error: "Товару ще немає на Prom (зʼявиться після імпорту YML на Prom)" };
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  await setSetting(`promCheck:${id}`, JSON.stringify({ at: new Date().toISOString(), ...result }));
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}#prom`);
}

/** Мінімальний залишок товару (порожньо — підказка додатку за продажами) */
export async function setMinStock(formData: FormData) {
  const user = await requirePerm("products.edit");
  const id = Number(formData.get("id"));
  const raw = String(formData.get("minStock") ?? "").trim().replace(",", ".");
  const val = raw === "" ? null : Number(raw);
  if (val !== null && (!Number.isFinite(val) || val < 0)) redirect(`/products/${id}`);
  await db.product.update({ where: { id }, data: { minStock: val } });
  await logAction(user.id, "min-stock", "product", id, val === null ? "авто" : String(val));
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}`);
}
