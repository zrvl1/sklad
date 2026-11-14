import Link from "next/link";
import { db } from "@/lib/db";
import { dateTimeUa, getSetting, money } from "@/lib/util";
import { can, requireUser } from "@/lib/auth";
import { pickStatusIds } from "@/lib/picking";

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

  return (
    <>
      <h1>Головна</h1>
      {deniedMsg}
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
