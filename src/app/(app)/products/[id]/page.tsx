import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { dateUa, money } from "@/lib/util";
import ProductForm from "../ProductForm";
import { addProductCell, removeProductCell, retryPush } from "../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> };

export default async function ProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { saved } = await searchParams;
  const product = await db.product.findUnique({
    where: { id: Number(id) },
    include: {
      stocks: { include: { warehouse: true } },
      cells: { include: { cell: { include: { warehouse: true } } } },
      receiptLines: {
        where: { receipt: { status: "posted" } },
        include: { receipt: { include: { supplier: true } } },
        orderBy: { id: "desc" },
        take: 20,
      },
    },
  });
  if (!product) notFound();
  const [suppliers, cells] = await Promise.all([
    db.supplier.findMany({ orderBy: { name: "asc" } }),
    db.cell.findMany({ include: { warehouse: true }, orderBy: [{ warehouseId: "asc" }, { code: "asc" }] }),
  ]);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>{product.name}</h1>
        <span className="spacer" />
        <a className="btn" href={`/print/labels?items=${product.id}:1`} target="_blank">
          🖨 Цінник
        </a>
        <Link className="btn" href="/products">
          До списку
        </Link>
      </div>

      {saved === "1" && <div className="msg ok">Збережено і відправлено в SalesDrive.</div>}
      {product.syncError && (
        <div className="msg err">
          Не вдалося відправити в SalesDrive: {product.syncError}
          <form action={retryPush} style={{ display: "inline", marginLeft: 10 }}>
            <input type="hidden" name="id" value={product.id} />
            <button className="btn sm">Повторити</button>
          </form>
        </div>
      )}

      <ProductForm product={product} suppliers={suppliers} />

      <div className="grid2">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Залишки</h2>
          {product.stocks.length === 0 && <p className="muted">Немає даних. Синхронізуйте з SalesDrive.</p>}
          {product.stocks.map((s) => (
            <div key={s.warehouseId} className="row" style={{ justifyContent: "space-between" }}>
              <span>{s.warehouse.name}</span>
              <b>{s.qty}</b>
            </div>
          ))}
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Комірки</h2>
          {product.cells.map((c) => (
            <form key={c.cellId} action={removeProductCell} className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="cellId" value={c.cellId} />
              <span>
                <b>{c.cell.code}</b> <span className="muted small">{c.cell.warehouse.name}</span>
              </span>
              <span>
                {c.qty} шт <button className="btn sm danger">✕</button>
              </span>
            </form>
          ))}
          <form action={addProductCell} className="row" style={{ marginTop: 10 }}>
            <input type="hidden" name="productId" value={product.id} />
            <select name="cellId" required defaultValue="">
              <option value="" disabled>
                Комірка…
              </option>
              {cells.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} ({c.warehouse.name})
                </option>
              ))}
            </select>
            <input name="qty" type="number" step="any" placeholder="К-сть" style={{ width: 80 }} />
            <button className="btn sm">Додати</button>
          </form>
          {cells.length === 0 && (
            <p className="muted small">
              Комірок ще немає — створіть їх у <Link href="/settings">Налаштуваннях</Link>.
            </p>
          )}
        </div>
      </div>

      <h2>Історія приходів</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Документ</th>
              <th>Постачальник</th>
              <th className="num">К-сть</th>
              <th className="num">Закупівля</th>
            </tr>
          </thead>
          <tbody>
            {product.receiptLines.map((l) => (
              <tr key={l.id}>
                <td>{dateUa(l.receipt.date)}</td>
                <td>
                  <Link href={`/receipts/${l.receiptId}`}>{l.receipt.number}</Link>
                </td>
                <td>{l.receipt.supplier?.name ?? "—"}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{money(l.cost)}</td>
              </tr>
            ))}
            {product.receiptLines.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Приходів ще не було
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
