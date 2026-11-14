import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { dateTimeUa } from "@/lib/util";
import { MOVE_TYPES } from "@/lib/labels";
import { moveProduct, placeByCode, setQtyInCell } from "../../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> };

// Комірка: вміст, сканування товару в комірку, переміщення, коригування
export default async function CellPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const cell = await db.cell.findUnique({
    where: { id: Number(id) },
    include: {
      warehouse: true,
      products: { include: { product: true }, orderBy: { product: { name: "asc" } } },
      moves: { include: { product: true, user: true }, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!cell) notFound();
  const others = await db.cell.findMany({ where: { warehouseId: cell.warehouseId, id: { not: cell.id } }, orderBy: { code: "asc" } });
  const items = cell.products;
  const total = items.reduce((s, x) => s + x.qty, 0);
  const printItems = items.filter((x) => x.qty > 0).map((x) => `${x.productId}:1`).join(",");

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>📍 {cell.code}</h1>
        <span className="muted">{cell.warehouse.name}</span>
        <span className="spacer" />
        <a className="btn" href={`/print/cells?ids=${cell.id}`} target="_blank">
          🖨 Етикетка комірки
        </a>
        {printItems && (
          <a className="btn" href={`/print/labels?items=${printItems}`} target="_blank">
            🖨 Цінники на вміст
          </a>
        )}
        <Link className="btn" href="/warehouse">
          До складу
        </Link>
      </div>
      {sp.msg && <div className="msg ok">{sp.msg}</div>}
      {sp.err && <div className="msg err">{sp.err}</div>}

      <form action={placeByCode} className="panel row">
        <input type="hidden" name="cellId" value={cell.id} />
        <label style={{ flex: 1, minWidth: 240 }}>
          Покласти в комірку: відскануйте товар
          <input className="scan" name="code" autoFocus autoComplete="off" placeholder="Штрихкод / артикул / артикул постачальника" />
        </label>
        <label style={{ width: 90 }}>
          К-сть
          <input name="qty" type="number" step="any" defaultValue={1} />
        </label>
        <button className="btn primary">Додати</button>
      </form>

      <p className="small muted">
        Позицій: <b>{items.filter((x) => x.qty > 0).length}</b> · Штук: <b>{total}</b>
        {cell.note && ` · ${cell.note}`}
      </p>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th style={{ width: 170 }}>Кількість</th>
              <th>Перемістити в іншу комірку</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={`${x.productId}-${x.qty}`}>
                <td>
                  <Link href={`/products/${x.productId}`}>{x.product.name}</Link>
                  <div className="muted small">{[x.product.sku, x.product.barcode].filter(Boolean).join(" · ")}</div>
                </td>
                <td>
                  <form action={setQtyInCell} className="row" style={{ gap: 6 }}>
                    <input type="hidden" name="productId" value={x.productId} />
                    <input type="hidden" name="cellId" value={cell.id} />
                    <input name="qty" type="number" step="any" defaultValue={x.qty} style={{ width: 80 }} />
                    <button className="btn sm" title="Зберегти кількість">
                      ✓
                    </button>
                  </form>
                </td>
                <td>
                  {x.qty > 0 && (
                    <form action={moveProduct} className="row" style={{ gap: 6 }}>
                      <input type="hidden" name="productId" value={x.productId} />
                      <input type="hidden" name="fromCellId" value={cell.id} />
                      <select name="toCellId" required defaultValue="">
                        <option value="" disabled>
                          куди…
                        </option>
                        {others.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code}
                          </option>
                        ))}
                      </select>
                      <input name="qty" type="number" step="any" defaultValue={x.qty} style={{ width: 70 }} />
                      <button className="btn sm">→</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  Комірка порожня
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Останні операції</h2>
      <div className="tablewrap">
        <table className="small">
          <tbody>
            {cell.moves.map((m) => (
              <tr key={m.id}>
                <td>{dateTimeUa(m.createdAt)}</td>
                <td>{MOVE_TYPES[m.type] ?? m.type}</td>
                <td>{m.product.name}</td>
                <td className="num" style={{ color: m.qty < 0 ? "var(--err)" : "var(--ok)" }}>
                  {m.qty > 0 ? "+" : ""}
                  {m.qty}
                </td>
                <td>{m.user?.name ?? "система"}</td>
                <td className="muted">{m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
