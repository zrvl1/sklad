import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { dateTimeUa, money } from "@/lib/util";
import InventoryEditor from "./InventoryEditor";
import { deleteInventory } from "../actions";

export default async function InventoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await db.inventory.findUnique({
    where: { id: Number(id) },
    include: { warehouse: true, createdBy: true, lines: { include: { product: true, cell: true }, orderBy: { id: "asc" } } },
  });
  if (!inv) notFound();

  if (inv.status === "draft") {
    const ids = [...new Set(inv.lines.map((l) => l.productId))];
    const [cells, stocks, suppliers] = await Promise.all([
      db.cell.findMany({ where: { warehouseId: inv.warehouseId }, orderBy: { code: "asc" } }),
      db.stockBalance.findMany({ where: { warehouseId: inv.warehouseId, productId: { in: ids } } }),
      db.supplier.findMany({ orderBy: { name: "asc" } }),
    ]);
    return (
      <>
        <div className="toolbar">
          <h1 style={{ margin: 0 }}>Інвентаризація {inv.number}</h1>
          <span className="badge warn">чернетка</span>
          <span className="muted">{inv.warehouse.name}</span>
          <span className="spacer" />
          <form action={deleteInventory}>
            <input type="hidden" name="id" value={inv.id} />
            <button className="btn danger">Видалити</button>
          </form>
        </div>
        <InventoryEditor
          inventoryId={inv.id}
          warehouseId={inv.warehouseId}
          note={inv.note ?? ""}
          lines={inv.lines.map((l) => ({
            key: `${l.productId}:${l.cellId ?? 0}`,
            productId: l.productId,
            name: l.product.name,
            sku: l.product.sku,
            barcode: l.product.barcode,
            cellId: l.cellId,
            counted: l.counted,
          }))}
          stock={Object.fromEntries(stocks.map((s) => [s.productId, s.qty]))}
          cells={cells.map((c) => ({ id: c.id, code: c.code }))}
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        />
      </>
    );
  }

  // Проведена: підсумок по товарах
  const byProduct = new Map<number, { name: string; cost: number; system: number; counted: number; cells: string[] }>();
  for (const l of inv.lines) {
    const x = byProduct.get(l.productId) ?? { name: l.product.name, cost: l.product.cost, system: l.systemQty ?? 0, counted: 0, cells: [] as string[] };
    x.counted += l.counted;
    if (l.cell) x.cells.push(`${l.cell.code}: ${l.counted}`);
    byProduct.set(l.productId, x);
  }
  const rows = [...byProduct.entries()].map(([pid, x]) => ({ pid, ...x, diff: x.counted - x.system }));
  const shortage = rows.filter((r) => r.diff < 0).reduce((s, r) => s + r.diff * r.cost, 0);
  const surplus = rows.filter((r) => r.diff > 0).reduce((s, r) => s + r.diff * r.cost, 0);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Інвентаризація {inv.number}</h1>
        <span className="badge ok">проведено</span>
        <span className="spacer" />
        <Link className="btn" href="/inventory">
          До списку
        </Link>
      </div>
      <p className="small muted">
        {inv.warehouse.name} · провів {inv.createdBy.name} · {dateTimeUa(inv.postedAt)}
        {inv.note && ` · ${inv.note}`}
      </p>
      <div className="stats">
        <div className="stat">
          Пораховано товарів
          <b>{rows.length}</b>
        </div>
        <div className="stat">
          З розбіжностями
          <b>{rows.filter((r) => r.diff !== 0).length}</b>
        </div>
        <div className="stat">
          Нестача (за собівартістю)
          <b style={{ color: "var(--err)" }}>{money(shortage)}</b>
        </div>
        <div className="stat">
          Надлишок (за собівартістю)
          <b style={{ color: "var(--ok)" }}>{money(surplus)}</b>
        </div>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th>Комірки</th>
              <th className="num">Облік</th>
              <th className="num">Факт</th>
              <th className="num">Різниця</th>
              <th className="num">Сума різниці</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .sort((a, b) => Math.abs(b.diff * b.cost) - Math.abs(a.diff * a.cost))
              .map((r) => (
                <tr key={r.pid}>
                  <td>
                    <Link href={`/products/${r.pid}`}>{r.name}</Link>
                  </td>
                  <td className="small">{r.cells.join(", ") || "—"}</td>
                  <td className="num">{r.system}</td>
                  <td className="num">{r.counted}</td>
                  <td className="num" style={{ color: r.diff < 0 ? "var(--err)" : r.diff > 0 ? "var(--ok)" : undefined }}>
                    {r.diff > 0 ? "+" : ""}
                    {r.diff}
                  </td>
                  <td className="num">{money(r.diff * r.cost)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
