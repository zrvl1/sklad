import { db } from "./db";
import { reorderRows, salesByBase } from "./demand";
import { uaKwMissing } from "./langcheck";
import { ua } from "./names";
import { saleStatusFilter } from "./finance";

/**
 * «Поради»: автоматичний аналіз роботи. Кожна порада — що не так, чому це важливо і куди натиснути.
 * Правила прості й прозорі: усе рахується з даних додатку (склад, заявки SalesDrive, витрати з «Гроші за місяць»).
 */
export type Insight = {
  level: "high" | "mid" | "low";
  area: "Склад" | "Ціни" | "Відмови" | "Реклама" | "Картки" | "Prom" | "Облік";
  title: string;
  detail: string;
  href?: string;
  items?: { label: string; href: string }[];
};

const plink = (p: { id: number; name: string; nameTranslate?: string | null }, extra = "") => ({ label: `${ua(p)}${extra}`, href: `/products/${p.id}` });

export async function buildInsights(): Promise<Insight[]> {
  const out: Insight[] = [];
  const [{ rows }, s90] = await Promise.all([reorderRows(), salesByBase(90)]);
  const byId = new Map(rows.map((r) => [r.id, r]));

  // ── Склад ──
  const lost = rows.filter((r) => r.sold90 > 0 && r.stock <= 0).sort((a, b) => b.sold90 - a.sold90);
  if (lost.length)
    out.push({
      level: "high",
      area: "Склад",
      title: `Немає в наявності товарів, які продаються: ${lost.length}`,
      detail: "Кожен день без них — втрачені замовлення, а реклама на них не працює. Дозамовте в першу чергу.",
      href: "/products/reorder",
      items: lost.slice(0, 10).map((r) => plink(r, ` — продано ${r.sold90} за 90 дн`)),
    });
  const below = rows.filter((r) => r.below && r.stock > 0);
  if (below.length)
    out.push({
      level: "mid",
      area: "Склад",
      title: `Скоро закінчиться: ${below.length}`,
      detail: "Залишок на рівні мінімуму або нижче. Сформуйте замовлення постачальникам.",
      href: "/products/reorder",
      items: below.slice(0, 8).map((r) => plink(r, ` — ${r.stock} шт`)),
    });
  const dead = rows.filter((r) => r.stock > 0 && r.sold90 === 0 && r.stock * r.cost > 0).sort((a, b) => b.stock * b.cost - a.stock * a.cost);
  const deadValue = dead.reduce((s, r) => s + r.stock * r.cost, 0);
  if (dead.length)
    out.push({
      level: deadValue > 20000 ? "mid" : "low",
      area: "Склад",
      title: `Без продажів 90 днів: ${dead.length} товарів на ${Math.round(deadValue).toLocaleString("uk-UA")} грн`,
      detail:
        "Гроші заморожені на полиці. Перевірте, чому не купують: є фото? зрозуміла сумісність? ціна не вища за конкурентів на Prom? Далі — знижка, відео, окрема реклама або розпродаж. Не дозамовляйте.",
      href: "/reports/abc?cls=dead",
      items: dead.slice(0, 8).map((r) => plink(r, ` — ${r.stock} шт`)),
    });

  // ── Ціни ──
  const products = await db.product.findMany({
    where: { deletedAt: null, baseProductId: null },
    select: { id: true, name: true, nameTranslate: true, price: true, cost: true, images: true, manufacturer: true, keywords: true, keywordsUa: true, description: true, sdId: true },
  });
  const loss = products.filter((p) => p.cost > 0 && p.price > 0 && p.price <= p.cost);
  if (loss.length)
    out.push({
      level: "high",
      area: "Ціни",
      title: `Ціна не вища за собівартість: ${loss.length}`,
      detail: "Кожен продаж — у мінус (ще й комісія Prom і доставка). Перевірте ціну або собівартість.",
      items: loss.slice(0, 10).map((p) => plink(p, ` — ціна ${p.price}, собів. ${Math.round(p.cost)}`)),
    });
  const thin = products.filter((p) => p.cost > 0 && p.price > p.cost && (p.price - p.cost) / p.price < 0.2);
  if (thin.length)
    out.push({
      level: "mid",
      area: "Ціни",
      title: `Маржа менше 20%: ${thin.length}`,
      detail:
        "Після комісії Prom (з ProSale) і реклами такі товари майже нічого не заробляють. Підніміть ціну, знайдіть дешевшого постачальника або не рекламуйте їх окремо.",
      items: thin
        .sort((a, b) => (s90.get(b.id)?.qty ?? 0) - (s90.get(a.id)?.qty ?? 0))
        .slice(0, 10)
        .map((p) => plink(p, ` — ${Math.round(((p.price - p.cost) / p.price) * 100)}%`)),
    });

  // ── Відмови ──
  const statusesRaw = await db.setting.findUnique({ where: { key: "sdStatuses" } });
  const refusedIds = statusesRaw?.value
    ? (JSON.parse(statusesRaw.value) as { id: number; name: string }[]).filter((s) => /відмов|поверн/i.test(s.name)).map((s) => s.id)
    : [];
  const saleFilter = await saleStatusFilter();
  const saleIds: number[] = "statusId" in saleFilter ? (saleFilter.statusId as { in: number[] }).in : [];
  if (refusedIds.length && saleIds.length) {
    const since = new Date(Date.now() - 90 * 86400_000);
    const lines = await db.sdOrderLine.findMany({
      where: { productId: { not: null }, order: { orderTime: { gte: since }, statusId: { in: [...refusedIds, ...saleIds] } } },
      select: { productId: true, order: { select: { statusId: true } }, product: { select: { baseProductId: true } } },
    });
    const stat = new Map<number, { sold: number; refused: number }>();
    for (const l of lines) {
      const id = l.product?.baseProductId ?? l.productId!;
      const s = stat.get(id) ?? { sold: 0, refused: 0 };
      if (refusedIds.includes(l.order.statusId)) s.refused++;
      else s.sold++;
      stat.set(id, s);
    }
    const bad = [...stat.entries()]
      .filter(([, s]) => s.refused >= 2 && s.refused / (s.sold + s.refused) >= 0.3)
      .sort((a, b) => b[1].refused - a[1].refused);
    const totalRef = [...stat.values()].reduce((t, s) => t + s.refused, 0);
    const totalAll = [...stat.values()].reduce((t, s) => t + s.refused + s.sold, 0);
    if (bad.length)
      out.push({
        level: "mid",
        area: "Відмови",
        title: `Часто відмовляються: ${bad.length} товарів`,
        detail: `За 90 днів у цих товарів 30%+ відмов (загалом по магазину ${totalAll ? Math.round((totalRef / totalAll) * 100) : 0}%). Типові причини: не підійшла сумісність, фото не збігається з тим, що приїхало, клієнт знайшов дешевше. Перевірте опис, фото й сумісність; менеджер має записувати причину відмови.`,
        items: bad.slice(0, 10).map(([id, s]) => {
          const p = byId.get(id);
          return { label: `${p ? ua(p) : `#${id}`} — ${s.refused} відмов з ${s.sold + s.refused}`, href: `/products/${id}` };
        }),
      });
  }

  // ── Реклама (минулий повний місяць) ──
  const now = new Date();
  const mFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const mTo = new Date(now.getFullYear(), now.getMonth(), 1);
  const [spend, mOrders] = await Promise.all([
    db.expense.findMany({ where: { kind: "expense", date: { gte: mFrom, lt: mTo }, category: { contains: "Реклама" } }, select: { category: true, amount: true } }),
    db.sdOrder.findMany({
      where: { orderTime: { gte: mFrom, lt: mTo }, ...(saleIds.length ? { statusId: { in: saleIds } } : {}) },
      select: { amount: true, costAmount: true, commission: true, utmCampaign: true },
    }),
  ]);
  const monthName = mFrom.toLocaleString("uk-UA", { month: "long", year: "numeric" });
  if (!spend.length)
    out.push({
      level: "mid",
      area: "Облік",
      title: `Не внесено витрати на рекламу за ${monthName}`,
      detail: "Без них не видно, чи окупається реклама. Внесіть суми з Google Ads і Prom у «Гроші за місяць» зі статтею, де є назва кампанії.",
      href: "/reports/expenses",
    });
  const byCamp = new Map<string, number>();
  for (const e of spend) {
    const camp = e.category.split("—")[1]?.trim();
    if (camp) byCamp.set(camp, (byCamp.get(camp) ?? 0) + e.amount);
  }
  for (const [camp, sum] of byCamp) {
    const profit = mOrders
      .filter((o) => o.utmCampaign && o.utmCampaign.toLowerCase().includes(camp.toLowerCase()))
      .reduce((s, o) => s + o.amount - o.costAmount - o.commission, 0);
    const ratio = sum > 0 ? profit / sum : 0;
    if (ratio < 1)
      out.push({
        level: "high",
        area: "Реклама",
        title: `Кампанія ${camp} у мінусі за ${monthName}`,
        detail: `Витрати ${Math.round(sum)} грн, валовий прибуток із її замовлень ${Math.round(profit)} грн. Перевірте пошукові запити (мінус-слова), товари з низькою маржею в кампанії, відхилені товари в Merchant Center. Якщо 2 тижні без покращення — зменшіть бюджет.`,
        href: "/reports/channels",
      });
    else if (ratio < 1.5)
      out.push({
        level: "mid",
        area: "Реклама",
        title: `Кампанія ${camp} на межі окупності за ${monthName}`,
        detail: `На 1 грн реклами — ${ratio.toFixed(2)} грн валового прибутку. Після доставки й відмов це майже нуль. Почистіть запити й приберіть із кампанії товари класу C та з маржею < 20%.`,
        href: "/reports/channels",
      });
    else if (ratio >= 3)
      out.push({
        level: "low",
        area: "Реклама",
        title: `Кампанія ${camp} добре окупається (${ratio.toFixed(1)} грн прибутку на 1 грн)`,
        detail: "Можна поступово збільшити бюджет на 15–20% і через тиждень перевірити, чи тримається результат.",
        href: "/reports/channels",
      });
  }

  // ── Картки: найважливіші — ті, що продаються ──
  const selling = products.filter((p) => (s90.get(p.id)?.qty ?? 0) > 0 || (byId.get(p.id)?.stock ?? 0) > 0);
  const noPhoto = selling.filter((p) => !p.images || p.images === "[]");
  if (noPhoto.length)
    out.push({
      level: "mid",
      area: "Картки",
      title: `Без фото (у наявності або продаються): ${noPhoto.length}`,
      detail: "Без фото товар майже не купують, а Google Merchant його відхиляє.",
      href: "/products/fill?f=photo",
      items: noPhoto.slice(0, 8).map((p) => plink(p)),
    });
  const noBrand = selling.filter((p) => !p.manufacturer?.trim());
  if (noBrand.length)
    out.push({ level: "low", area: "Картки", title: `Без бренду: ${noBrand.length}`, detail: "Бренд потрібен для Merchant Center і фільтрів.", href: "/products/fill?f=man" });
  const noUa = selling.filter((p) => p.keywords?.trim() && uaKwMissing(p.keywordsUa, p.keywords));
  if (noUa.length)
    out.push({
      level: "low",
      area: "Prom",
      title: `Без українських пошукових запитів: ${noUa.length}`,
      detail: "Перекладіть ключові слова і залийте файл українських запитів на Prom (Налаштування → Prom).",
      href: "/products/fill?f=kwua",
    });
  const shortDesc = selling.filter((p) => (p.description ?? "").replace(/<[^>]+>/g, "").trim().length < 80);
  if (shortDesc.length)
    out.push({
      level: "low",
      area: "Картки",
      title: `Короткий опис (< 80 символів): ${shortDesc.length}`,
      detail: "Додайте сумісність списком і параметри — це і SEO, і менше питань та відмов.",
      items: shortDesc.slice(0, 8).map((p) => plink(p)),
    });

  // ── Однакові назви: Хорошоп робить сторінки-дублі з /ID/, Google індексує лише одну ──
  const all = await db.product.findMany({ where: { deletedAt: null }, select: { id: true, name: true, nameTranslate: true, sku: true } });
  const byName = new Map<string, typeof all>();
  for (const p of all) {
    const k = ua(p).trim().toLowerCase().replace(/\s+/g, " ");
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const dupGroups = [...byName.values()].filter((g) => g.length > 1);
  if (dupGroups.length)
    out.push({
      level: "mid",
      area: "Картки",
      title: `Однакові назви в різних товарів: ${dupGroups.length} груп (${dupGroups.reduce((s, g) => s + g.length, 0)} товарів)`,
      detail:
        "На сайті такі товари отримують адреси-дублі з номером у кінці, і Google індексує лише одну сторінку з групи — решта не потрапляє в пошук. Зробіть назви унікальними: бренд деталі, оригінал/аналог або кількість у комплекті.",
      href: "/products/dupes",
      items: dupGroups.slice(0, 10).map((g) => ({ label: `${ua(g[0])} — ${g.map((p) => p.sku).join(", ")}`, href: `/products/${g[0].id}` })),
    });

  // ── Prom: товари, яких немає на Prom ──
  const promLinks = await db.promLink.findMany({ select: { externalId: true } });
  if (promLinks.length) {
    const onProm = new Set(promLinks.map((l) => l.externalId));
    const notOnProm = products.filter((p) => p.sdId && !onProm.has(p.sdId));
    if (notOnProm.length)
      out.push({
        level: "low",
        area: "Prom",
        title: `Немає на Prom: ${notOnProm.length}`,
        detail: "Ці товари є в SalesDrive, але Prom їх не імпортував. Перевірте історію імпорту Prom (помилки, обовʼязкові поля, категорія).",
        items: notOnProm.slice(0, 8).map((p) => plink(p)),
      });
  }

  // ── Облік ──
  const [oldDrafts, syncErr] = await Promise.all([
    db.receipt.count({ where: { status: "draft", createdAt: { lt: new Date(Date.now() - 3 * 86400_000) } } }),
    db.product.count({ where: { syncError: { not: null }, deletedAt: null } }),
  ]);
  if (oldDrafts)
    out.push({ level: "low", area: "Облік", title: `Чернетки приходів старші 3 днів: ${oldDrafts}`, detail: "Проведіть або видаліть, щоб залишки були точні.", href: "/receipts?status=draft" });
  if (syncErr)
    out.push({ level: "mid", area: "Облік", title: `Помилки відправки в SalesDrive: ${syncErr}`, detail: "Ці зміни не дійшли до CRM і на сайти.", href: "/products?errors=1" });

  const order = { high: 0, mid: 1, low: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
