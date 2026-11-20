import { ua } from "@/lib/names";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { dateTimeUa, money } from "@/lib/util";
import WriteOffEditor from "./WriteOffEditor";
import { deleteWriteOff } from "../actions";

export default async function WriteOffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const w = await db.writeOff.findUnique({
    where: { id: Number(id) },
    include: { warehouse: true, createdBy: true, lines: { include: { product: true, cell: true }, orderBy: { id: "asc" } } },
  });
  if (!w) notFound();

  if (w.status === "draft") {
    const [cells, stocks] = await Promise.all([
      db.cell.findMany({ where: { warehouseId: w.warehouseId }, orderBy: { code: "asc" } }),
      db.stockBalance.findMany({ where: { warehouseId: w.warehouseId, productId: { in: w.lines.map((l) => l.productId) } } }),
    ]);
    const stock = new Map<number, number>(stocks.map((s) => [s.productId, s.qty]));
    return (
      <>
        <div className="toolbar">
          <h1 style={{ margin: 0 }}>Списання {w.number}</h1>
          <span className="badge warn">чернетка</span>
          <span className="muted">{w.warehouse.name}</span>
          <span className="spacer" />
          <form action={deleteWriteOff}>
            <input type="hidden" name="id" value={w.id} />
            <button className="btn danger">Видалити</button>
          </form>
        </div>
        <WriteOffEditor
          id={w.id}
          warehouseId={w.warehouseId}
          reason={w.reason}
          note={w.note ?? ""}
          cells={cells.map((c) => ({ id: c.id, code: c.code }))}
          lines={w.lines.map((l) => ({
            key: String(l.id),
            productId: l.productId,
            name: ua(l.product),
            sku: l.product.sku,
            barcode: l.product.barcode,
            cost: l.product.cost,
            stock: stock.get(l.productId) ?? 0,
            qty: l.qty,
            cellId: l.cellId,
          }))}
        />
      </>
    );
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Списання {w.number}</h1>
        <span className="badge ok">проведено</span>
        <span className="spacer" />
        <Link className="btn" href="/writeoffs">
          До списку
        </Link>
      </div>
      <p className="small muted">
        {w.warehouse.name} · причина: <b>{w.reason}</b> · {w.createdBy.name} · {dateTimeUa(w.postedAt)}
        {w.note && ` · ${w.note}`}
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th>Комірка</th>
              <th className="num">К-сть</th>
              <th className="num">Собівартість</th>
              <th className="num">Сума</th>
            </tr>
          </thead>
          <tbody>
            {w.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/products/${l.productId}`}>{ua(l.product)}</Link>
                </td>
                <td>{l.cell?.code ?? "авто"}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{money(l.cost)}</td>
                <td className="num">{money(l.qty * l.cost)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={4} className="num">
                <b>Разом</b>
              </td>
              <td className="num">
                <b>{money(w.total)}</b>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
