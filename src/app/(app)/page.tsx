import Link from "next/link";
import { db } from "@/lib/db";
import { dateTimeUa, getSetting, money } from "@/lib/util";
import { can, requireUser } from "@/lib/auth";
import { pickStatusIds } from "@/lib/picking";
import { reorderRows } from "@/lib/demand";
import { uaKwMissing } from "@/lib/langcheck";
import { ua } from "@/lib/names";

/** Початок сьогоднішнього дня за Києвом */
function kyivDayStart() {
  const now = new Date();
  const kyiv = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
  const offset = kyiv.getTime() - now.getTime();
  const start = new Date(kyiv);
  start.setHours(0, 0, 0, 0);
  return new Date(start.getTime() - offset);
}

export default async function Home({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  const user = await requireUser();
  const deniedMsg = denied ? <div className="msg warn">Цей розділ недоступний для вашої ролі.</div> : null;

  // Менеджер заявок: лише робочі кнопки й черга на пакування, без сум і закупівель
  if (!can(user, "costs")) {
    const pick = await pickStatusIds();
    const [toPack, packedToday] = await Promise.all([
      pick.ids.length ? db.sdOrder.count({ where: { statusId: { in: pick.ids }, pack: null } }) : Promise.resolve(0),
      db.orderPack.count({ where: { packedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    ]);
    return (
      <>
        <h1>Привіт, {user.name}</h1>
        {deniedMsg}
        <div className="stats">
          <div className="stat">
            Чекають на пакування
            <b>{toPack}</b>
          </div>
          <div className="stat">
            Запаковано сьогодні
            <b>{packedToday}</b>
          </div>
        </div>
        <div className="toolbar">
          <Link className="btn primary" href="/picking/pack">
            📦 Пакування (скан ТТН)
          </Link>
          <Link className="btn" href="/picking">
            Збирання замовлень
          </Link>
          <Link className="btn" href="/warehouse">
            Де лежить товар
          </Link>
          <Link className="btn" href="/products">
            Товари
          </Link>
        </div>
      </>
    );
  }

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [products, noBarcode, drafts, monthReceipts, syncErrors, lastSyncRaw, syncWarning, pendingDeleted] = await Promise.all([
    db.product.count({ where: { deletedAt: null } }),
    db.product.count({ where: { deletedAt: null, OR: [{ barcode: null }, { barcode: "" }] } }),
    db.receipt.count({ where: { status: "draft" } }),
    db.receipt.aggregate({ where: { status: "posted", date: { gte: monthStart } }, _sum: { total: true }, _count: true }),
    db.product.count({ where: { syncError: { not: null } } }),
    getSetting("lastSync"),
    getSetting("syncWarning"),
    db.deletedProductSite.count({ where: { status: "todo" } }),
  ]);
  const lastSync = lastSyncRaw ? (JSON.parse(lastSyncRaw) as { at: string; total: number }) : null;

  // ── «Сьогодні»: що треба зробити зараз ──
  const dayStart = kyivDayStart();
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const pick = await pickStatusIds();
  const baseWhere = { deletedAt: null, baseProductId: null };
  const [toPack, packedToday, newToday, week, reorder, noPhoto, noBrand, noCost, noCell, kwRows] = await Promise.all([
    pick.ids.length ? db.sdOrder.count({ where: { statusId: { in: pick.ids }, pack: null } }) : Promise.resolve(0),
    db.orderPack.count({ where: { packedAt: { gte: dayStart } } }),
    db.sdOrder.count({ where: { orderTime: { gte: dayStart } } }),
    db.sdOrder.aggregate({ where: { orderTime: { gte: weekAgo } }, _sum: { amount: true }, _count: true }),
    reorderRows(),
    db.product.count({ where: { ...baseWhere, OR: [{ images: null }, { images: "" }, { images: "[]" }] } }),
    db.product.count({ where: { ...baseWhere, OR: [{ manufacturer: null }, { manufacturer: "" }] } }),
    db.product.count({ where: { ...baseWhere, cost: { lte: 0 } } }),
    db.product.count({ where: { ...baseWhere, stocks: { some: { qty: { gt: 0 } } }, cells: { none: { qty: { gt: 0 } } } } }),
    db.product.findMany({ where: { deletedAt: null, keywords: { not: null } }, select: { keywords: true, keywordsUa: true } }),
  ]);
  const noUaKw = kwRows.filter((p) => p.keywords?.trim() && uaKwMissing(p.keywordsUa, p.keywords)).length;
  const below = reorder.rows.filter((r) => r.below).sort((a, b) => b.sold90 - a.sold90);
  const cardIssues = [
    { label: "Без фото", n: noPhoto, href: "/products/fill?f=photo" },
    { label: "Без бренду", n: noBrand, href: "/products/fill?f=man" },
    { label: "Без собівартості", n: noCost, href: "/products/fill?f=cost" },
    { label: "Без комірки (є залишок)", n: noCell, href: "/products/fill?f=cell" },
    { label: "Без українських ключових", n: noUaKw, href: "/products/fill?f=kwua" },
  ].filter((x) => x.n > 0);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Сьогодні</h1>
        <span className="spacer" />
        <Link className="btn sm" href="/insights">
          💡 Поради: що покращити
        </Link>
      </div>
      {deniedMsg}
      <div className="stats">
        <Link className="stat" href="/picking">
          Чекають на пакування
          <b>{toPack}</b>
          <span className="muted small">запаковано сьогодні: {packedToday}</span>
        </Link>
        <div className="stat">
          Нових заявок сьогодні
          <b>{newToday}</b>
          <span className="muted small">
            за 7 днів: {week._count} на {money(week._sum.amount)} грн
          </span>
        </div>
        <Link className="stat" href="/products/reorder" style={below.length ? { background: "#fbebeb" } : undefined}>
          Нижче мінімуму
          <b>{below.length}</b>
          <span className="muted small">що дозамовити →</span>
        </Link>
      </div>
      {below.length > 0 && (
        <div className="panel small">
          <b>Закінчується:</b>{" "}
          {below.slice(0, 8).map((r, i) => (
            <span key={r.id}>
              {i > 0 && " · "}
              <Link href={`/products/${r.id}`}>{ua(r)}</Link> ({r.stock} шт)
            </span>
          ))}
          {below.length > 8 && <> · <Link href="/products/reorder">ще {below.length - 8}</Link></>}
        </div>
      )}
      {cardIssues.length > 0 && (
        <div className="panel small">
          <b>Картки товарів, які треба доповнити:</b>{" "}
          {cardIssues.map((x, i) => (
            <span key={x.href}>
              {i > 0 && " · "}
              <Link href={x.href}>
                {x.label}: {x.n}
              </Link>
            </span>
          ))}
        </div>
      )}
      {syncWarning && <div className="msg warn small">⚠ {syncWarning}</div>}
      {pendingDeleted > 0 && (
        <div className="msg warn">
          Є видалені товари, які ще треба прибрати на сайтах: <b>{pendingDeleted}</b>. <Link href="/products/deleted">Відкрити список</Link>
        </div>
      )}
      <div className="toolbar">
        <Link className="btn primary" href="/receipts/new">
          + Новий прихід
        </Link>
        <Link className="btn" href="/products/new">
          + Новий товар
        </Link>
        <Link className="btn" href="/writeoffs">
          Списання
        </Link>
        <Link className="btn" href="/inventory">
          Інвентаризація
        </Link>
        <Link className="btn" href="/products?print=1">
          Друк цінників
        </Link>
      </div>
      <div className="stats">
        <div className="stat">
          Товарів
          <b>{products}</b>
        </div>
        <div className="stat">
          Приходів за місяць
          <b>{monthReceipts._count}</b>
          <span className="muted small">на {money(monthReceipts._sum.total)} грн</span>
        </div>
        <div className="stat">
          Чернетки приходів
          <b>{drafts}</b>
          {drafts > 0 && <Link href="/receipts?status=draft">відкрити</Link>}
        </div>
        <div className="stat">
          Без штрихкоду
          <b>{noBarcode}</b>
          {noBarcode > 0 && <Link href="/products?nobarcode=1">показати</Link>}
        </div>
        <div className="stat">
          Помилки відправки в CRM
          <b>{syncErrors}</b>
          {syncErrors > 0 && <Link href="/products?errors=1">показати</Link>}
        </div>
      </div>
      <p className="muted small">
        Дані з SalesDrive оновлюються автоматично кожні 15 хвилин. Остання синхронізація: {lastSync ? `${dateTimeUa(new Date(lastSync.at))}, товарів: ${lastSync.total}` : "ще не було"}.{" "}
        <Link href="/settings">Синхронізувати</Link>
      </p>
    </>
  );
}
