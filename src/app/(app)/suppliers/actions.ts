"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getSetting, logAction, setSetting, str } from "@/lib/util";
import { manualRates } from "@/lib/currency";
import { refreshSupplierFeed, syncRrpPrices } from "@/lib/supplierFeed";
import { bookedFor, supplierBalance } from "@/lib/supplierLedger";

const back = (path: string, msg: string, err = false) => {
  revalidatePath(path);
  redirect(`${path}?${err ? "err" : "msg"}=${encodeURIComponent(msg)}`);
};
const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/** Курс валюти на сьогодні (вводить власник) → ціни товарів з РРЦ перераховуються й ідуть у SalesDrive */
export async function setRate(formData: FormData) {
  const user = await requirePerm("costs");
  const code = (str(formData.get("code")) ?? "USD").toUpperCase();
  const rate = num(formData.get("rate"));
  const path = str(formData.get("back")) ?? "/suppliers";
  if (!(rate > 0) || rate > 1000) return back(path, "Вкажіть курс, напр. 41.85", true);
  const manual = await manualRates();
  manual[code] = { rate, at: new Date().toISOString() };
  await setSetting("manualRates", JSON.stringify(manual));
  await db.currency.upsert({ where: { code }, update: { rate }, create: { code, rate } });
  let hist: { code: string; rate: number; at: string }[] = [];
  try {
    hist = JSON.parse((await getSetting("rateHistory")) ?? "[]");
  } catch {}
  hist.unshift({ code, rate, at: new Date().toISOString() });
  await setSetting("rateHistory", JSON.stringify(hist.slice(0, 90)));
  await logAction(user.id, "set-rate", "currency", null, { code, rate });
  let note = "";
  try {
    const r = await syncRrpPrices();
    note = r.pricesChanged ? ` Перераховано цін з РРЦ: ${r.pricesChanged} (відправлено в SalesDrive).` : " Ціни з РРЦ не змінилися.";
  } catch (e) {
    note = ` Ціни не перераховано: ${e instanceof Error ? e.message : e}`;
  }
  back(path, `Курс ${code} = ${rate} грн збережено.${note}`);
}

export async function saveSupplierFeed(formData: FormData) {
  const user = await requirePerm("receipts");
  const id = Number(formData.get("id"));
  const path = `/suppliers/${id}`;
  const feedUrl = str(formData.get("feedUrl"));
  if (feedUrl && !/^https?:\/\//i.test(feedUrl)) return back(path, "Посилання має починатися з http:// або https://", true);
  const data = {
    name: str(formData.get("name")) ?? undefined,
    phone: str(formData.get("phone")),
    note: str(formData.get("note")),
    feedUrl,
    feedPriceType: formData.get("feedPriceType") === "cost" ? "cost" : "rrp",
    currency: (str(formData.get("currency")) ?? "UAH").toUpperCase(),
    roundTo: Math.max(1, Math.min(100, Number(formData.get("roundTo")) || 10)),
    extraParams: String(formData.get("extraParams") ?? "").trim(),
    ledgerFrom: str(formData.get("ledgerFrom")) ? new Date(`${str(formData.get("ledgerFrom"))}T00:00:00+02:00`) : null,
  };
  await db.supplier.update({ where: { id }, data });
  await logAction(user.id, "save", "supplier", id, { ...data, feedUrl: feedUrl ? "set" : null });
  back(path, "Збережено");
}

export async function loadFeed(formData: FormData) {
  const user = await requirePerm("receipts");
  const id = Number(formData.get("id"));
  const path = `/suppliers/${id}`;
  try {
    const r = await refreshSupplierFeed(id);
    await logAction(user.id, "feed", "supplier", id, r);
    back(
      path,
      `Фід завантажено: ${r.items} товарів (нових ${r.created}, змінених ${r.updated}${r.gone ? `, зникли з фіду ${r.gone}` : ""}). Змінено цін у ваших товарах: ${r.pricesChanged}.`
    );
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect
    back(path, `Фід не завантажено: ${e instanceof Error ? e.message : e}`, true);
  }
}

/** Оплата постачальнику: скільки валюти віддали і скільки гривень це реально коштувало */
export async function addPayment(formData: FormData) {
  const user = await requirePerm("costs");
  const supplierId = Number(formData.get("supplierId"));
  const path = `/suppliers/${supplierId}`;
  const s = await db.supplier.findUniqueOrThrow({ where: { id: supplierId } });
  const currency = (str(formData.get("currency")) ?? s.currency).toUpperCase();
  const amount = num(formData.get("amount"));
  const uah = currency === "UAH" ? amount : num(formData.get("uah"));
  if (!(amount > 0)) return back(path, "Вкажіть суму оплати", true);
  if (!(uah > 0)) return back(path, "Вкажіть, скільки гривень коштувала ця валюта (купівля валюти або готівка)", true);
  const dateStr = str(formData.get("date"));
  const date = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
  const account = str(formData.get("account"));
  if (!s.ledgerFrom) await db.supplier.update({ where: { id: supplierId }, data: { ledgerFrom: date } }); // перша оплата — старт обліку
  const bal = await supplierBalance(supplierId, currency, s.ledgerFrom ?? date);
  const booked = bookedFor(bal, amount, uah);
  const diff = Math.round((uah - booked) * 100) / 100;
  let expenseId: number | null = null;
  if (Math.abs(diff) >= 1) {
    const e = await db.expense.create({
      data: {
        date,
        kind: diff > 0 ? "expense" : "income",
        category: "Курсова різниця",
        amount: Math.abs(diff),
        account,
        note: `${s.name}: оплата ${amount} ${currency} за ${uah} грн (курс ${(uah / amount).toFixed(2)}), у собівартості за ${(booked / amount).toFixed(2)}`,
        createdById: user.id,
      },
    });
    expenseId = e.id;
  }
  await db.supplierPayment.create({
    data: { supplierId, date, currency, amount, uah, bookedUah: booked, diffUah: diff, expenseId, note: str(formData.get("note")), createdById: user.id },
  });
  await logAction(user.id, "payment", "supplier", supplierId, { amount, currency, uah, diff });
  back(
    path,
    `Оплату ${amount} ${currency} записано.` +
      (Math.abs(diff) >= 1 ? ` Курсова різниця ${diff > 0 ? "−" : "+"}${Math.abs(diff)} грн записана в «Гроші за місяць».` : " Курсової різниці немає.")
  );
}

export async function deletePayment(formData: FormData) {
  const user = await requirePerm("costs");
  const id = Number(formData.get("id"));
  const p = await db.supplierPayment.findUniqueOrThrow({ where: { id } });
  if (p.expenseId) await db.expense.deleteMany({ where: { id: p.expenseId } });
  await db.supplierPayment.delete({ where: { id } });
  await logAction(user.id, "payment-delete", "supplier", p.supplierId, { amount: p.amount, currency: p.currency });
  back(`/suppliers/${p.supplierId}`, "Оплату видалено");
}

export async function saveDescFooter(formData: FormData) {
  const user = await requirePerm("products.edit");
  await setSetting("descFooterUa", String(formData.get("ua") ?? "").trim());
  await setSetting("descFooterRu", String(formData.get("ru") ?? "").trim());
  await logAction(user.id, "save", "setting", "descFooter");
  back("/suppliers", "Текст у кінці опису збережено — додаватиметься до нових товарів з XML");
}

/** Дописати текст про сумісність у кінець опису всіх товарів, де його (або схожого «Не впевнені…») ще немає */
export async function appendFooterAll() {
  const user = await requirePerm("products.edit");
  const { descFooters } = await import("@/lib/supplierFeed");
  const f = await descFooters();
  const has = (t: string | null) => /Не впевнені|Не уверены|Перед замовленням перевірте|Перед заказом проверьте/i.test(t ?? "");
  // опис невідомий (null) — не чіпаємо: інакше в SalesDrive затерли б наявний текст
  const ps = await db.product.findMany({ where: { deletedAt: null, description: { not: null } } });
  const changed: number[] = [];
  for (const p of ps) {
    const data: { description?: string; descriptionTranslate?: string } = {};
    if (p.description && !has(p.description)) data.description = `${p.description.trim()}\n${f.ru}`;
    if (p.descriptionTranslate?.trim() && !has(p.descriptionTranslate)) data.descriptionTranslate = `${p.descriptionTranslate.trim()}\n${f.ua}`;
    if (!Object.keys(data).length) continue;
    await db.product.update({ where: { id: p.id }, data: { ...data, textEditedAt: new Date() } });
    changed.push(p.id);
  }
  let sdErr = "";
  const { isSalesDriveConfigured, productToSd, sdUpdateProducts } = await import("@/lib/salesdrive");
  if (isSalesDriveConfigured() && changed.length) {
    const fresh = await db.product.findMany({ where: { id: { in: changed }, sdId: { not: null } } });
    for (let i = 0; i < fresh.length; i += 100) {
      try {
        await sdUpdateProducts(fresh.slice(i, i + 100).map((p) => productToSd(p, null, { withDetails: true })));
      } catch (e) {
        sdErr = ` Помилка SalesDrive: ${e instanceof Error ? e.message : e}`;
      }
    }
  }
  const skipped = await db.product.count({ where: { deletedAt: null, description: null } });
  await logAction(user.id, "append-footer", "product", null, { changed: changed.length });
  back(
    "/suppliers",
    `Текст про сумісність дописано в ${changed.length} товарів і відправлено в SalesDrive.${skipped ? ` Без опису в додатку (не чіпали): ${skipped}.` : ""}${sdErr}`,
    Boolean(sdErr)
  );
}

export async function createSupplier(formData: FormData) {
  const user = await requirePerm("receipts");
  const name = str(formData.get("name"));
  if (!name) return back("/suppliers", "Вкажіть назву", true);
  const s = await db.supplier.upsert({ where: { name }, update: {}, create: { name, phone: str(formData.get("phone")) } });
  await logAction(user.id, "save", "supplier", s.id);
  redirect(`/suppliers/${s.id}`);
}

/** Зіставлення категорій фіду з категоріями сайту + створення дерева */
export async function saveFeedCategories(formData: FormData) {
  const user = await requirePerm("products.edit");
  const supplierId = Number(formData.get("supplierId"));
  const path = `/suppliers/${supplierId}/categories`;
  const { allCategories, createCategoryTree, findCategory } = await import("@/lib/categories");
  let note = "";
  const tree = String(formData.get("tree") ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (tree.length) {
    try {
      const r = await createCategoryTree(tree);
      await logAction(user.id, "create-tree", "category", null, r);
      note = r.created ? `Створено категорій у SalesDrive: ${r.created}. ` : "Нових категорій не було — усі вже існують. ";
    } catch (e) {
      return back(path, `Дерево не створено: ${e instanceof Error ? e.message : e}`, true);
    }
  }
  let map: Record<string, string> = {};
  try {
    map = JSON.parse((await getSetting("feedCategoryMap")) ?? "{}");
  } catch {}
  const cats = await allCategories();
  let saved = 0;
  const bad: string[] = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("fc:")) continue;
    const feedCat = k.slice(3);
    const val = String(v).trim();
    const key = `${supplierId}:${feedCat}`;
    if (!val) {
      if (map[key]) delete map[key];
      continue;
    }
    const c = (await findCategory(val)) ?? cats.find((x) => x.path.toLowerCase() === val.toLowerCase());
    if (!c) {
      bad.push(val);
      continue;
    }
    if (map[key] !== c.path) saved++;
    map[key] = c.path;
  }
  await setSetting("feedCategoryMap", JSON.stringify(map));
  revalidatePath(`/suppliers/${supplierId}`);
  back(path, `${note}Зіставлень збережено: ${saved}.${bad.length ? ` Не знайдено категорій: ${bad.slice(0, 5).join(", ")}` : ""}`, bad.length > 0 && !saved);
}
