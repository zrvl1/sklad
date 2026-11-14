import Link from "next/link";
import { db } from "@/lib/db";
import { dateUa } from "@/lib/util";
import { createInventory } from "./actions";

export default async function InventoryList() {
  const [items, warehouses] = await Promise.all([
    db.inventory.findMany({
      include: { warehouse: true, createdBy: true, _count: { select: { lines: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Інвентаризація</h1>
        <span className="spacer" />
        <form action={createInventory} className="row" style={{ gap: 6 }}>
          <select name="warehouseId" defaultValue={warehouses.find((w) => w.isDefault)?.id}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button className="btn primary">+ Нова інвентаризація</button>
        </form>
      </div>
      <p className="muted small">
        Рахуйте комірку за коміркою: відскануйте етикетку комірки, потім товари в ній. Проводити можна частинами — змінюються лише ті товари, які ви
        порахували.
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Номер</th>
              <th>Дата</th>
              <th>Склад</th>
              <th className="num">Рядків</th>
              <th>Статус</th>
              <th>Хто</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link href={`/inventory/${i.id}`}>{i.number}</Link>
                </td>
                <td>{dateUa(i.date)}</td>
                <td>{i.warehouse.name}</td>
                <td className="num">{i._count.lines}</td>
                <td>{i.status === "posted" ? <span className="badge ok">проведено</span> : <span className="badge warn">чернетка</span>}</td>
                <td className="small">{i.createdBy.name}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Інвентаризацій ще не було
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
