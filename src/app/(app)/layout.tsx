import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="shell">
      <nav className="side no-print">
        <div className="brand">📦 Склад</div>
        <Link href="/">Головна</Link>
        <Link href="/products">Товари</Link>
        <Link href="/receipts">Прихід товару</Link>
        <Link href="/products?print=1">Друк цінників</Link>
        <Link href="/reports">Звіти</Link>
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
