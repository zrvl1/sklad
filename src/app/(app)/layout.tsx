import Link from "next/link";
import { after } from "next/server";
import { ROLE_LABELS, can, requireUser } from "@/lib/auth";
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
        {can(user, "products.edit") && <Link href="/products/kits">Комплекти (картки)</Link>}
        {can(user, "receipts") && <Link href="/receipts">Прихід товару</Link>}
        {can(user, "writeoffs") && <Link href="/writeoffs">Списання</Link>}
        {can(user, "picking") && <Link href="/picking">Збирання замовлень</Link>}
        {can(user, "packing") && <Link href="/picking/pack">Пакування</Link>}
        {can(user, "inventory") && <Link href="/inventory">Інвентаризація</Link>}
        {can(user, "labels") && <Link href="/products?print=1">Друк цінників</Link>}
        {can(user, "products.edit") && <Link href="/products/codes">Штрихкоди й артикули</Link>}
        {can(user, "products.edit") && <Link href="/products/templates">Шаблони опису</Link>}
        {can(user, "products.edit") && (
          <Link href="/products/deleted">
            Видалені товари{" "}
            {pendingSites > 0 && (
              <span className="badge warn" title="Треба прибрати на сайтах">
                {pendingSites}
              </span>
            )}
          </Link>
        )}
        {can(user, "reports") && <Link href="/reports/sales">Звіт: продажі</Link>}
        {can(user, "reports") && <Link href="/reports">Звіт: приходи</Link>}
        {can(user, "reports") && <Link href="/reports/expenses">Витрати (реклама)</Link>}
        <Link href="/settings">{can(user, "settings") ? "Налаштування" : "Мій профіль"}</Link>
        <div className="bottom">
          <div>{user.name}</div>
          <div className="small" style={{ opacity: 0.7 }}>
            {ROLE_LABELS[user.role] ?? user.role}
          </div>
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
