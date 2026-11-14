import Link from "next/link";
import { db } from "@/lib/db";
import { dateUa, money } from "@/lib/util";
import { createWriteOff } from "./actions";

export default async function WriteOffList({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const now = new Date();
  const from = sp.from ? new Date(sp.from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = sp.to ? new Date(`${sp.to}T23:59:59`) : now;
  const [items, warehouses, byReason] = await Promise.all([
    db.writeOff.findMany({
      where: { date: { gte: from, lte: to } },
      include: { warehouse: true, createdBy: true, _count: { select: { lines: true } } },
      orderBy: { date: "desc" },
      take: 200,
    }),
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
    db.writeOff.groupBy({ by: ["reason"], where: { status: "posted", date: { gte: from, lte: to } }, _sum: { total: true } }),
  ]);
  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Списання</h1>
        <span className="spacer" />
        <form action={createWriteOff} className="row" style={{ gap: 6 }}>
          <select name="warehouseId" defaultValue={warehouses.find((w) => w.isDefault)?.id}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button className="btn primary">+ Нове списання</button>
        </form>
      </div>
      <form className="toolbar">
        <input type="date" name="from" defaultValue={from.toISOString().slice(0, 10)} />
        <input type="date" name="to" defaultValue={to.toISOString().slice(0, 10)} />
        <button className="btn">Показати</button>
      </form>
      <div className="stats">
        {byReason.map((r) => (
          <div className="stat" key={r.reason}>
            {r.reason}
            <b>{money(r._sum.total)}</b>
          </div>
        ))}
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Номер</th>
              <th>Дата</th>
              <th>Причина</th>
              <th className="num">Позицій</th>
              <th className="num">Сума (собів.)</th>
              <th>Статус</th>
              <th>Хто</th>
            </tr>
          </thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id}>
                <td>
                  <Link href={`/writeoffs/${w.id}`}>{w.number}</Link>
                </td>
                <td>{dateUa(w.date)}</td>
                <td>{w.reason}</td>
                <td className="num">{w._count.lines}</td>
                <td className="num">{money(w.total)}</td>
                <td>{w.status === "posted" ? <span className="badge ok">проведено</span> : <span className="badge warn">чернетка</span>}</td>
                <td className="small">{w.createdBy.name}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Списань за період немає
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
