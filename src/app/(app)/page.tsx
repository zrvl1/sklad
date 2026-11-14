import Link from "next/link";
import { db } from "@/lib/db";
import { dateTimeUa, getSetting, money } from "@/lib/util";

export default async function Home() {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [products, noBarcode, drafts, monthReceipts, syncErrors, lastSyncRaw] = await Promise.all([
    db.product.count(),
    db.product.count({ where: { OR: [{ barcode: null }, { barcode: "" }] } }),
    db.receipt.count({ where: { status: "draft" } }),
    db.receipt.aggregate({ where: { status: "posted", date: { gte: monthStart } }, _sum: { total: true }, _count: true }),
    db.product.count({ where: { syncError: { not: null } } }),
    getSetting("lastSync"),
  ]);
  const lastSync = lastSyncRaw ? (JSON.parse(lastSyncRaw) as { at: string; total: number }) : null;

  return (
    <>
      <h1>Головна</h1>
      <div className="toolbar">
        <Link className="btn primary" href="/receipts/new">
          + Новий прихід
        </Link>
        <Link className="btn" href="/products/new">
          + Новий товар
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
        Остання синхронізація з SalesDrive: {lastSync ? `${dateTimeUa(new Date(lastSync.at))}, товарів: ${lastSync.total}` : "ще не було"}.{" "}
        <Link href="/settings">Синхронізувати</Link>
      </p>
    </>
  );
}
