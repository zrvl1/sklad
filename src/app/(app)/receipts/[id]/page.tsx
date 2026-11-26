import { promCommissions } from "@/lib/commission";
import { mainImage } from "@/lib/images";
import { ua } from "@/lib/names";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { dateInput, dateTimeUa, dateUa, money } from "@/lib/util";
import { getRates } from "@/lib/currency";
import { allCategories } from "@/lib/categories";
import { can, requireUser } from "@/lib/auth";
import ReceiptEditor from "./ReceiptEditor";
import { deleteReceipt } from "../actions";
import PrintReceiptLabels from "./PrintReceiptLabels";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ posted?: string; warn?: string }> };

export default async function ReceiptPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { posted, warn } = await searchParams;
  const r = await db.receipt.findUnique({
    where: { id: Number(id) },
    include: {
      lines: { include: { product: true, cell: true }, orderBy: { id: "asc" } },
      warehouse: true,
      supplier: true,
      createdBy: true,
      postedBy: true,
    },
  });
  if (!r) notFound();
  // загальний залишок товарів приходу (по всіх складах)
  const totals = await db.stockBalance.groupBy({ by: ["productId"], where: { productId: { in: r.lines.map((l) => l.productId) } }, _sum: { qty: true } });
  const stockOf = new Map(totals.map((t) => [t.productId, t._sum.qty ?? 0]));
  const prom = r.status === "draft" ? (await promCommissions(r.lines.map((l) => l.productId))).byProduct : new Map();

  if (r.status === "draft") {
    const suppliers = await db.supplier.findMany({ orderBy: { name: "asc" } });
    // валюта закупівлі: увімкнена в налаштуваннях або є постачальник, з яким розрахунки у валюті
    const showCurrency = process.env.ENABLE_CURRENCY === "true" || suppliers.some((s) => s.currency !== "UAH") || r.currency !== "UAH";
    const [warehouses, cells, rates, categories] = await Promise.all([
      db.warehouse.findMany({ orderBy: { name: "asc" } }),
      db.cell.findMany({ orderBy: { code: "asc" } }),
      showCurrency ? getRates() : Promise.resolve({ UAH: 1 } as Record<string, number>),
      allCategories(),
    ]);
    return (
      <>
        <div className="toolbar">
          <h1 style={{ margin: 0 }}>Прихід {r.number}</h1>
          <span className="badge warn">чернетка</span>
          <span className="spacer" />
          <form action={deleteReceipt}>
            <input type="hidden" name="id" value={r.id} />
            <button className="btn danger">Видалити чернетку</button>
          </form>
        </div>
        <ReceiptEditor
          receiptId={r.id}
          initial={{
            date: dateInput(r.date),
            warehouseId: r.warehouseId,
            supplierId: r.supplierId,
            invoiceNo: r.invoiceNo ?? "",
            note: r.note ?? "",
            currency: r.currency,
            rate: r.rateFixed ? String(r.rate) : "",
            lines: r.lines.map((l) => ({
              key: String(l.id),
              productId: l.productId,
              name: ua(l.product),
              sku: l.product.sku,
              barcode: l.product.barcode,
              price: l.product.price,
              qty: l.qty,
              cost: l.cost,
              prevCost: l.product.cost,
              newPrice: l.newPrice,
              cellId: l.cellId,
              image: mainImage(l.product.images),
              stockTotal: stockOf.get(l.productId) ?? 0,
              promPct: prom.get(l.productId)?.pct ?? null,
              promCat: prom.get(l.productId)?.catName ?? null,
            })),
          }}
          warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, currency: s.currency }))}
          cells={cells.map((c) => ({ id: c.id, code: c.code, warehouseId: c.warehouseId }))}
          rates={rates}
          showCurrency={showCurrency}
          categories={categories}
          canCreate={can(await requireUser(), "products.edit")}
        />
      </>
    );
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Прихід {r.number}</h1>
        <span className="badge ok">проведено</span>
        <span className="spacer" />
        <Link className="btn" href="/receipts">
          До журналу
        </Link>
      </div>
      <div className="panel grid2 small">
        <div>
          Дата: <b>{dateUa(r.date)}</b>
        </div>
        <div>
          Склад: <b>{r.warehouse.name}</b>
        </div>
        <div>
          Постачальник: <b>{r.supplier?.name ?? "—"}</b>
        </div>
        <div>
          Накладна: <b>{r.invoiceNo ?? "—"}</b>
        </div>
        {r.currency !== "UAH" && (
          <div>
            Валюта: <b>{r.currency}</b> · курс {r.rate} грн
          </div>
        )}
        <div>
          Створив: {r.createdBy.name}
        </div>
        <div>
          Провів: {r.postedBy?.name ?? "—"}, {dateTimeUa(r.postedAt)}
        </div>
        {r.note && <div style={{ gridColumn: "1 / -1" }}>Коментар: {r.note}</div>}
      </div>

      {warn && <div className="msg warn">{warn}</div>}
      <PrintReceiptLabels receiptId={r.id} highlight={posted === "1"} />

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Фото</th>
              <th>Товар</th>
              <th className="num">Зараз на складі</th>
              <th>Штрихкод</th>
              <th>Комірка</th>
              <th className="num">К-сть</th>
              <th className="num">Закупівля, {r.currency === "UAH" ? "грн" : r.currency}</th>
              <th className="num">Сума, {r.currency === "UAH" ? "грн" : r.currency}</th>
              <th className="num">Нова ціна</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l, i) => (
              <tr key={l.id}>
                <td>{i + 1}</td>
                <td>
                  {mainImage(l.product.images) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mainImage(l.product.images)!} alt="" loading="lazy" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", border: "1px solid var(--line)", borderRadius: 4 }} />
                  ) : (
                    <span className="muted small">—</span>
                  )}
                </td>
                <td>
                  <Link href={`/products/${l.productId}`}>{ua(l.product)}</Link>
                </td>
                <td className="num">{stockOf.get(l.productId) ?? 0}</td>
                <td>{l.product.barcode}</td>
                <td>{l.cell?.code ?? "—"}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{money(l.cost)}</td>
                <td className="num">{money(l.qty * l.cost)}</td>
                <td className="num">{l.newPrice ? money(l.newPrice) : "—"}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={8} className="num">
                <b>Разом</b>
              </td>
              <td className="num">
                <b>{money(r.currency === "UAH" ? r.total : r.totalCurrency)}</b>
                {r.currency !== "UAH" && <div className="muted small">{money(r.total)} грн</div>}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
