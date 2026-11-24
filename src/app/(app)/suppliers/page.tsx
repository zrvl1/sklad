import Link from "next/link";
import { db } from "@/lib/db";
import { can, requirePerm } from "@/lib/auth";
import { dateTimeUa, money } from "@/lib/util";
import { supplierBalance } from "@/lib/supplierLedger";
import RateForm from "@/components/RateForm";
import { createSupplier } from "./actions";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const user = await requirePerm("receipts");
  const sp = await searchParams;
  const showMoney = can(user, "costs");
  const suppliers = await db.supplier.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { items: true } } } });
  const balances = showMoney
    ? await Promise.all(suppliers.map((s) => (s.ledgerFrom ? supplierBalance(s.id, s.currency, s.ledgerFrom) : null)))
    : [];
  const linked = await db.product.groupBy({ by: ["supplierId"], where: { supplierId: { not: null }, deletedAt: null }, _count: true });
  return (
    <>
      <h1>Постачальники</h1>
      {sp.msg && <div className="msg">{sp.msg}</div>}
      {sp.err && <div className="msg err">{sp.err}</div>}
      {showMoney && <RateForm />}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Постачальник</th>
              <th>Фід</th>
              <th>Товарів у фіді</th>
              <th>Наших карток</th>
              {showMoney && <th>Борг</th>}
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s, i) => {
              const b = balances[i];
              return (
                <tr key={s.id}>
                  <td>
                    <Link href={`/suppliers/${s.id}`}>{s.name}</Link>
                    {s.phone && <div className="small muted">{s.phone}</div>}
                  </td>
                  <td className="small">
                    {s.feedUrl ? (s.feedError ? <span className="badge err">помилка</span> : `оновлено ${dateTimeUa(s.feedAt)}`) : <span className="muted">—</span>}
                  </td>
                  <td>{s._count.items || "—"}</td>
                  <td>{linked.find((l) => l.supplierId === s.id)?._count ?? "—"}</td>
                  {showMoney && (
                    <td>
                      {b && Math.abs(b.debt) >= 0.01 ? (
                        <>
                          <b>
                            {money(b.debt)} {b.currency}
                          </b>
                          {b.currency !== "UAH" && <div className="small muted">≈ {money(b.debtUah)} грн у собівартості</div>}
                        </>
                      ) : b ? (
                        <span className="muted">0</span>
                      ) : (
                        <span className="small muted">не ведеться</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <form action={createSupplier} className="row" style={{ marginTop: 12 }}>
          <input name="name" placeholder="Новий постачальник" />
          <input name="phone" placeholder="Телефон" />
          <button className="btn sm">Додати</button>
        </form>
      </div>
    </>
  );
}
