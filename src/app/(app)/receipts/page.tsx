import Link from "next/link";
import { db } from "@/lib/db";
import { dateUa, money } from "@/lib/util";
import { createReceipt } from "./actions";
import { receiptFilter, type ReceiptFilter } from "@/lib/receipts";

type SP = Promise<ReceiptFilter>;

export default async function ReceiptsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const where = receiptFilter(sp);
  const [receipts, suppliers, warehouses, sum] = await Promise.all([
    db.receipt.findMany({
      where,
      include: { supplier: true, warehouse: true, createdBy: true, _count: { select: { lines: true } } },
      orderBy: { date: "desc" },
      take: 200,
    }),
    db.supplier.findMany({ orderBy: { name: "asc" } }),
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
    db.receipt.aggregate({ where: { ...where, status: "posted" }, _sum: { total: true } }),
  ]);
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Прихід товару</h1>
        <span className="spacer" />
        <form action={createReceipt}>
          <button className="btn primary">+ Новий прихід</button>
        </form>
      </div>

      <form className="panel row">
        <label>
          З
          <input type="date" name="from" defaultValue={sp.from} />
        </label>
        <label>
          По
          <input type="date" name="to" defaultValue={sp.to} />
        </label>
        <label>
          Постачальник
          <select name="supplier" defaultValue={sp.supplier ?? ""}>
            <option value="">усі</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Склад
          <select name="warehouse" defaultValue={sp.warehouse ?? ""}>
            <option value="">усі</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Статус
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">усі</option>
            <option value="draft">чернетки</option>
            <option value="posted">проведені</option>
          </select>
        </label>
        <label>
          № / накладна
          <input name="q" defaultValue={sp.q} style={{ width: 130 }} />
        </label>
        <button className="btn">Показати</button>
        <a className="btn" href={`/api/receipts/export?${exportQs}`}>
          ⬇ Excel (CSV)
        </a>
      </form>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Номер</th>
              <th>Дата</th>
              <th>Склад</th>
              <th>Постачальник</th>
              <th>Накладна</th>
              <th className="num">Позицій</th>
              <th className="num">Сума</th>
              <th>Статус</th>
              <th>Створив</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/receipts/${r.id}`}>{r.number}</Link>
                </td>
                <td>{dateUa(r.date)}</td>
                <td>{r.warehouse.name}</td>
                <td>{r.supplier?.name ?? "—"}</td>
                <td>{r.invoiceNo ?? ""}</td>
                <td className="num">{r._count.lines}</td>
                <td className="num">{money(r.total)}</td>
                <td>{r.status === "posted" ? <span className="badge ok">проведено</span> : <span className="badge warn">чернетка</span>}</td>
                <td className="small">{r.createdBy.name}</td>
              </tr>
            ))}
            {receipts.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  Документів немає
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p>
        Разом проведено за фільтром: <b>{money(sum._sum.total)} грн</b>
      </p>
    </>
  );
}
