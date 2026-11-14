import Link from "next/link";
import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { maybeAutoSync } from "@/lib/autosync";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Постійний обмін із SalesDrive: після відповіді сторінки перевіряємо, чи не час оновити дані
  after(() => maybeAutoSync());
  const pendingSites = await db.deletedProductSite.count({ where: { status: "todo" } });

  return (
    <div className="shell">
      <nav className="side no-print">
        <div className="brand">📦 Склад</div>
        <Link href="/">Головна</Link>
        <Link href="/warehouse">Склад і комірки</Link>
        <Link href="/products">Товари</Link>
        <Link href="/products/kits">Комплекти (картки)</Link>
        <Link href="/receipts">Прихід товару</Link>
        <Link href="/writeoffs">Списання</Link>
        <Link href="/picking">Збирання замовлень</Link>
        <Link href="/inventory">Інвентаризація</Link>
        <Link href="/products?print=1">Друк цінників</Link>
        <Link href="/products/codes">Штрихкоди й артикули</Link>
        <Link href="/products/templates">Шаблони опису</Link>
        <Link href="/products/deleted">
          Видалені товари{" "}
          {pendingSites > 0 && (
            <span className="badge warn" title="Треба прибрати на сайтах">
              {pendingSites}
            </span>
          )}
        </Link>
        <Link href="/reports/sales">Звіт: продажі</Link>
        <Link href="/reports">Звіт: приходи</Link>
        <Link href="/settings">Налаштування</Link>
        <div className="bottom">
          <div>{user.name}</div>
          <form action={logout}>
            <button className="btn sm" style={{ marginTop: 6 }}>
              Вийти
            </button>
          </form>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
