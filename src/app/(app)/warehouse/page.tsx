import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { searchProducts } from "@/lib/codes";
import { placeProduct } from "./actions";

type SP = Promise<{ wh?: string; q?: string; msg?: string; err?: string }>;

// Карта складу: де що лежить, пошук, нерозкладений товар
export default async function WarehousePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const warehouses = await db.warehouse.findMany({ orderBy: { name: "asc" } });
  const wh = warehouses.find((w) => w.id === Number(sp.wh)) ?? warehouses.find((w) => w.isDefault) ?? warehouses[0];
  if (!wh) return <p>Спершу створіть склад у Налаштуваннях.</p>;

  // Відсканована етикетка комірки — одразу відкриваємо комірку
  if (sp.q?.trim().toUpperCase().startsWith("CELL:")) {
    const code = sp.q.trim().slice(5).toUpperCase();
    const cell = await db.cell.findFirst({ where: { code, warehouseId: wh.id } }) ?? (await db.cell.findFirst({ where: { code } }));
    if (cell) redirect(`/warehouse/cells/${cell.id}`);
  }

  const [cells, stocks, placed] = await Promise.all([
    db.cell.findMany({
      where: { warehouseId: wh.id },
      include: { products: { select: { qty: true } } },
      orderBy: { code: "asc" },
    }),
    db.stockBalance.findMany({ where: { warehouseId: wh.id, qty: { gt: 0 } }, include: { product: true } }),
    db.productCell.groupBy({ by: ["productId"], where: { cell: { warehouseId: wh.id } }, _sum: { qty: true } }),
  ]);
  const placedMap = new Map(placed.map((p) => [p.productId, p._sum.qty ?? 0]));
  const unplaced = stocks
    .map((s) => ({ product: s.product, stock: s.qty, placed: placedMap.get(s.productId) ?? 0 }))
    .filter((x) => x.placed < x.stock)
    .sort((a, b) => b.stock - b.placed - (a.stock - a.placed));

  // Групуємо комірки за зоною (перша частина коду, напр. "A" з "A-01-2")
  const zones = new Map<string, typeof cells>();
  for (const c of cells) {
    const z = c.code.split("-")[0];
    zones.set(z, [...(zones.get(z) ?? []), c]);
  }

  const found = sp.q?.trim() ? await searchProducts(sp.q, 15) : [];
  const foundCells = found.length
    ? await db.productCell.findMany({
        where: { productId: { in: found.map((f) => f.id) } },
        include: { cell: { include: { warehouse: true } } },
        orderBy: { qty: "desc" },
      })
    : [];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Склад</h1>
        {warehouses.length > 1 &&
          warehouses.map((w) => (
            <Link key={w.id} className={`btn sm ${w.id === wh.id ? "primary" : ""}`} href={`/warehouse?wh=${w.id}`}>
              {w.name}
            </Link>
          ))}
        <span className="spacer" />
        <Link className="btn" href="/inventory">
          Інвентаризація
        </Link>
        <a className="btn" href={`/print/cells?warehouse=${wh.id}`} target="_blank">
          🖨 Етикетки комірок
        </a>
      </div>
      {sp.msg && <div className="msg ok">{sp.msg}</div>}
      {sp.err && <div className="msg err">{sp.err}</div>}

      <form className="panel">
        <input type="hidden" name="wh" value={wh.id} />
        <label>
          Де лежить товар?
          <input className="scan" name="q" defaultValue={sp.q} placeholder="Скануйте штрихкод або введіть назву / артикул" autoFocus />
        </label>
        {sp.q && found.length === 0 && <p className="muted">Нічого не знайдено.</p>}
        {found.map((p) => {
          const pc = foundCells.filter((c) => c.productId === p.id);
          return (
            <div key={p.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
              <Link href={`/products/${p.id}`}>
                <b>{p.name}</b>
              </Link>{" "}
              <span className="muted small">{[p.sku, p.barcode].filter(Boolean).join(" · ")}</span>
              <div style={{ marginTop: 4 }}>
                {pc.length === 0 && <span className="badge warn">не розміщено</span>}
                {pc.map((c) => (
                  <Link key={c.cellId} href={`/warehouse/cells/${c.cellId}`} className="badge" style={{ marginRight: 6, fontSize: 14 }}>
                    📍 {c.cell.code} — {c.qty} шт{c.cell.warehouseId !== wh.id ? ` (${c.cell.warehouse.name})` : ""}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </form>

      <h2>Комірки</h2>
      {cells.length === 0 && (
        <p className="muted">
          Комірок ще немає — створіть їх у <Link href="/settings">Налаштуваннях</Link>.
        </p>
      )}
      {[...zones.entries()].map(([zone, list]) => (
        <div key={zone} className="panel">
          <b>Зона {zone}</b>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, marginTop: 8 }}>
            {list.map((c) => {
              const positions = c.products.filter((p) => p.qty > 0).length;
              const qty = c.products.reduce((s, p) => s + p.qty, 0);
              return (
                <Link
                  key={c.id}
                  href={`/warehouse/cells/${c.id}`}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                    padding: "8px 10px",
                    background: positions ? "#eef5ff" : "#fff",
                    color: "var(--ink)",
                  }}
                >
                  <b>{c.code}</b>
                  <div className="small muted">{positions ? `${positions} поз. · ${qty} шт` : "порожня"}</div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      <h2>
        Не розкладено <span className="badge warn">{unplaced.length}</span>
      </h2>
      <p className="muted small">Товари, яких на складі (за SalesDrive) більше, ніж розміщено по комірках.</p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th className="num">На складі</th>
              <th className="num">У комірках</th>
              <th>Розмістити</th>
            </tr>
          </thead>
          <tbody>
            {unplaced.slice(0, 200).map((x) => (
              <tr key={x.product.id}>
                <td>
                  <Link href={`/products/${x.product.id}`}>{x.product.name}</Link>
                  <div className="muted small">{[x.product.sku, x.product.barcode].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="num">{x.stock}</td>
                <td className="num">{x.placed}</td>
                <td>
                  <form action={placeProduct} className="row" style={{ gap: 6 }}>
                    <input type="hidden" name="productId" value={x.product.id} />
                    <select name="cellId" required defaultValue="">
                      <option value="" disabled>
                        комірка…
                      </option>
                      {cells.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                    <input name="qty" type="number" step="any" defaultValue={x.stock - x.placed} style={{ width: 70 }} />
                    <button className="btn sm">OK</button>
                  </form>
                </td>
              </tr>
            ))}
            {unplaced.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Усе розкладено 👍
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
