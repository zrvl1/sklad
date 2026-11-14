import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { dateTimeUa, dateUa, money } from "@/lib/util";
import { MOVE_TYPES } from "@/lib/labels";
import ProductForm from "../ProductForm";
import { productFormContext } from "@/lib/templates";
import { can, requireUser } from "@/lib/auth";
import { parseParams } from "@/lib/salesdrive";
import { addProductCell, addProductCode, createKitCard, deleteProductForm, linkKitForm, removeProductCell, removeProductCode, retryPush, unlinkKit } from "../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; warn?: string }> };

export default async function ProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { saved, warn } = await searchParams;
  const product = await db.product.findUnique({
    where: { id: Number(id) },
    include: {
      base: true,
      kits: { where: { deletedAt: null }, orderBy: { sku: "asc" } },
      stocks: { include: { warehouse: true } },
      cells: { include: { cell: { include: { warehouse: true } } }, orderBy: { qty: "desc" } },
      codes: { include: { supplier: true }, orderBy: { createdAt: "asc" } },
      receiptLines: {
        where: { receipt: { status: "posted" } },
        include: { receipt: { include: { supplier: true } } },
        orderBy: { id: "desc" },
        take: 20,
      },
      moves: { include: { cell: true, user: true }, orderBy: { createdAt: "desc" }, take: 30 },
      saleLines: { include: { order: true }, orderBy: { order: { orderTime: "desc" } }, take: 20 },
    },
  });
  if (!product) notFound();
  const user = await requireUser();

  // Перегляд для менеджера: усе для дзвінка й пошуку (сумісність, комірка, коди), без собівартості й редагування
  if (!can(user, "products.edit")) {
    const view = product.base
      ? await db.product.findUnique({ where: { id: product.base.id }, include: { cells: { where: { qty: { gt: 0 } }, include: { cell: true } }, stocks: true } })
      : null;
    const physical = view ?? product;
    const params = parseParams(product.params);
    const descText = (product.description ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").trim();
    return (
      <>
        <div className="toolbar">
          <h1 style={{ margin: 0 }}>{product.name}</h1>
          <span className="spacer" />
          {can(user, "labels") && (
            <a className="btn" href={`/print/labels?items=${product.id}:1`} target="_blank">
              🖨 Наліпка
            </a>
          )}
          <Link className="btn" href="/products">
            До списку
          </Link>
        </div>
        {product.base && (
          <div className="msg warn">
            Картка-комплект. Фізично на складі — <b>{product.base.name}</b> ({product.base.sku ?? "—"}): шукайте й скануйте наліпку основного товару.
          </div>
        )}
        <div className="stats">
          <div className="stat">
            Ціна
            <b>{money(product.price)}</b>
          </div>
          <div className="stat">
            На складі
            <b>{physical.stocks.reduce((s, x) => s + x.qty, 0)}</b>
          </div>
          <div className="stat">
            Комірка
            <b>{physical.cells.filter((c) => c.qty > 0).map((c) => c.cell.code).join(", ") || "—"}</b>
          </div>
        </div>
        <div className="panel small">
          Артикул: <b>{product.sku ?? "—"}</b> · Штрихкод: <b>{product.barcode ?? "—"}</b> · ID: <b>{product.sdId ?? "—"}</b>
          {product.manufacturer && <> · Виробник: <b>{product.manufacturer}</b></>}
          {product.categoryName && <> · Категорія: <b>{product.categoryName}</b></>}
        </div>
        {params.length > 0 && (
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Характеристики</h2>
            <table className="small">
              <tbody>
                {params.map((p) => (
                  <tr key={p.name}>
                    <td className="muted">{p.name}</td>
                    <td>
                      <b>{p.value}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {descText && (
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Опис</h2>
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>
              {descText}
            </div>
          </div>
        )}
        {product.kits.length > 0 && (
          <div className="panel small">
            <b>Продається на сайті також як:</b>
            {product.kits.map((k) => (
              <div key={k.id}>
                ↳ {k.name} <span className="muted">· {k.sku ?? "—"}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }
  const [ctx, cells, sold30] = await Promise.all([
    productFormContext(),
    db.cell.findMany({ include: { warehouse: true }, orderBy: [{ warehouseId: "asc" }, { code: "asc" }] }),
    db.sdOrderLine.aggregate({
      where: { productId: product.id, order: { orderTime: { gte: new Date(Date.now() - 30 * 864e5) } } },
      _sum: { qty: true },
    }),
  ]);
  const suppliers = ctx.suppliers;
  const inCells = product.cells.reduce((s, c) => s + c.qty, 0);
  // Створення картки для сайту (комплект із цього товару) — під іншу модель/бренд для SEO
  const newCardForm = (
    <details style={{ marginTop: 8 }}>
      <summary className="small">
        <b>+ Створити картку для сайту</b> (комплект із цього товару під іншу модель чи бренд)
      </summary>
      <form action={createKitCard} className="row" style={{ marginTop: 10 }}>
        <input type="hidden" name="baseId" value={product.id} />
        <input name="name" required minLength={2} placeholder="Назва картки, напр. Гальмівні колодки передні Geon X-Road 250" style={{ flex: 1, minWidth: 280 }} />
        <input name="sku" placeholder={product.sku ? `${product.sku}-N (авто)` : "артикул"} style={{ width: 150 }} />
        <input name="price" type="number" min={0} step="0.01" placeholder={`ціна (${product.price})`} style={{ width: 120 }} />
        <button className="btn sm primary">Створити</button>
      </form>
      <p className="muted small">
        Опис, характеристики, категорія й виробник скопіюються з цього товару — потім відредагуйте їх під модель. У SalesDrive картка створиться як
        комплект, залишок списуватиметься з цього товару.
      </p>
    </details>
  );
  const stockTotal = product.stocks.reduce((s, x) => s + x.qty, 0);

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

      {product.deletedAt && (
        <div className="msg err">
          Товар видалено {dateUa(product.deletedAt)}. <Link href="/products/deleted?show=all">Журнал видалених</Link>
        </div>
      )}
      {saved === "1" && <div className="msg ok">Збережено і відправлено в SalesDrive.</div>}
      {warn && <div className="msg warn">⚠ {warn}</div>}
      {product.syncError && (
        <div className="msg err">
          Не вдалося відправити в SalesDrive: {product.syncError}
          <form action={retryPush} style={{ display: "inline", marginLeft: 10 }}>
            <input type="hidden" name="id" value={product.id} />
            <button className="btn sm">Повторити</button>
          </form>
        </div>
      )}

      <div className="stats">
        <div className="stat">
          На складі (SalesDrive)
          <b>{stockTotal}</b>
        </div>
        <div className="stat">
          Розкладено по комірках
          <b>{inCells}</b>
          {inCells < stockTotal && <span className="badge warn">не розкладено {stockTotal - inCells}</span>}
        </div>
        <div className="stat">
          Продано за 30 днів
          <b>{sold30._sum.qty ?? 0}</b>
        </div>
        <div className="stat">
          Ціна / собівартість
          <b>{money(product.price)}</b>
          <span className="muted small">
            {money(product.cost)} грн{product.costCurrency ? ` (${product.costOriginal} ${product.costCurrency})` : ""} · маржа {product.price > 0 ? Math.round(((product.price - product.cost) / product.price) * 100) : 0}%
          </span>
        </div>
      </div>

      {product.base ? (
        <form action={unlinkKit} className="msg warn">
          <input type="hidden" name="kitId" value={product.id} />
          Це <b>картка-комплект</b> (вітрина для сайту). Фізичний товар —{" "}
          <Link href={`/products/${product.base.id}`}>
            <b>{product.base.name}</b>
          </Link>{" "}
          ({product.base.sku ?? "—"}){product.kitQty !== 1 ? `, ×${product.kitQty} шт` : ""}. Прихід, комірки, наліпки й інвентаризація ведуться на
          основному товарі; скан цієї картки в документах підставить основний.{" "}
          <button className="btn sm">Відв&apos;язати</button>
        </form>
      ) : product.kits.length > 0 ? (
        <div className="panel">
          <b>Картки-комплекти цього товару ({product.kits.length})</b> — продаються на сайті під різні моделі, залишок списується з цього товару:
          {product.kits.map((k) => (
            <div key={k.id} className="small" style={{ padding: "2px 0 2px 12px" }}>
              ↳ <Link href={`/products/${k.id}`}>{k.name}</Link> <span className="muted">· {k.sku ?? "—"} · {k.price} грн</span>
            </div>
          ))}
          {newCardForm}
        </div>
      ) : (
        <details className="panel">
          <summary className="small">Це картка-комплект іншого товару? Прив&apos;язати до основного</summary>
          <form action={linkKitForm} className="row" style={{ marginTop: 10 }}>
            <input type="hidden" name="kitId" value={product.id} />
            <input name="baseCode" required placeholder="артикул, штрихкод або ID основного товару" style={{ width: 300 }} />
            <label className="check">
              штук основного в картці
              <input name="kitQty" type="number" min={1} step="any" defaultValue={1} style={{ width: 70 }} />
            </label>
            <button className="btn sm">Прив&apos;язати</button>
          </form>
        </details>
      )}
      {!product.base && product.kits.length === 0 && <div className="panel">{newCardForm}</div>}

      <ProductForm product={product} {...ctx} kitsCount={product.kits.length} />

      <div className="grid2">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Де лежить</h2>
          {product.cells.length === 0 && <p className="muted">Ще не розміщено в жодній комірці.</p>}
          {product.cells.map((c) => (
            <form key={c.cellId} action={removeProductCell} className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="cellId" value={c.cellId} />
              <span>
                <Link href={`/warehouse/cells/${c.cellId}`}>
                  <b>{c.cell.code}</b>
                </Link>{" "}
                <span className="muted small">{c.cell.warehouse.name}</span>
              </span>
              <span>
                {c.qty} шт <button className="btn sm danger" title="Прибрати з комірки">✕</button>
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
            <button className="btn sm">Встановити</button>
          </form>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Коди товару</h2>
          <div className="small" style={{ marginBottom: 8 }}>
            Штрихкод: <b>{product.barcode ?? "—"}</b> · Артикул: <b>{product.sku ?? "—"}</b> · ID: <b>{product.sdId ?? "—"}</b>
          </div>
          {product.codes.map((c) => (
            <form key={c.id} action={removeProductCode} className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
              <input type="hidden" name="id" value={c.id} />
              <span>
                <b>{c.code}</b>{" "}
                <span className="badge">{c.type === "supplier" ? `арт. постачальника${c.supplier ? ` · ${c.supplier.name}` : ""}` : "дод. штрихкод"}</span>
              </span>
              <button className="btn sm danger" title="Видалити код">
                ✕
              </button>
            </form>
          ))}
          <form action={addProductCode} className="row" style={{ marginTop: 10 }}>
            <input type="hidden" name="productId" value={product.id} />
            <input name="code" placeholder="Код" required style={{ width: 140 }} />
            <select name="type" defaultValue="supplier">
              <option value="supplier">арт. постачальника</option>
              <option value="barcode">дод. штрихкод</option>
            </select>
            <select name="supplierId" defaultValue="">
              <option value="">постачальник…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button className="btn sm">Додати</button>
          </form>
          <p className="muted small">За всіма цими кодами товар знаходиться при скануванні в приході, на складі й в інвентаризації.</p>
        </div>
      </div>

      <h2>Рух товару</h2>
      <div className="tablewrap">
        <table className="small">
          <thead>
            <tr>
              <th>Коли</th>
              <th>Операція</th>
              <th>Комірка</th>
              <th className="num">К-сть</th>
              <th>Хто</th>
              <th>Примітка</th>
            </tr>
          </thead>
          <tbody>
            {product.moves.map((m) => (
              <tr key={m.id}>
                <td>{dateTimeUa(m.createdAt)}</td>
                <td>
                  {m.docType === "receipt" && m.docId ? (
                    <Link href={`/receipts/${m.docId}`}>{MOVE_TYPES[m.type] ?? m.type}</Link>
                  ) : m.docType === "writeoff" && m.docId ? (
                    <Link href={`/writeoffs/${m.docId}`}>{MOVE_TYPES[m.type] ?? m.type}</Link>
                  ) : m.docType === "inventory" && m.docId ? (
                    <Link href={`/inventory/${m.docId}`}>{MOVE_TYPES[m.type] ?? m.type}</Link>
                  ) : (
                    MOVE_TYPES[m.type] ?? m.type
                  )}
                </td>
                <td>{m.cell?.code ?? "—"}</td>
                <td className="num" style={{ color: m.qty < 0 ? "var(--err)" : "var(--ok)" }}>
                  {m.qty > 0 ? "+" : ""}
                  {m.qty}
                </td>
                <td>{m.user?.name ?? "система"}</td>
                <td className="muted">{m.note}</td>
              </tr>
            ))}
            {product.moves.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Руху ще не було
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Приходи</h2>
          <div className="tablewrap">
            <table className="small">
              <tbody>
                {product.receiptLines.map((l) => (
                  <tr key={l.id}>
                    <td>{dateUa(l.receipt.date)}</td>
                    <td>
                      <Link href={`/receipts/${l.receiptId}`}>{l.receipt.number}</Link>
                    </td>
                    <td>{l.receipt.supplier?.name ?? "—"}</td>
                    <td className="num">{l.qty} шт</td>
                    <td className="num">{money(l.cost)}</td>
                  </tr>
                ))}
                {product.receiptLines.length === 0 && (
                  <tr>
                    <td className="muted">Приходів ще не було</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 style={{ marginTop: 0 }}>Продажі (з SalesDrive)</h2>
          <div className="tablewrap">
            <table className="small">
              <tbody>
                {product.saleLines.map((l) => (
                  <tr key={l.id}>
                    <td>{dateUa(l.order.orderTime)}</td>
                    <td>заявка {l.orderId}</td>
                    <td className="num">{l.qty} шт</td>
                    <td className="num">{money(l.price)}</td>
                  </tr>
                ))}
                {product.saleLines.length === 0 && (
                  <tr>
                    <td className="muted">Немає даних (див. Звіти → Продажі)</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {!product.deletedAt && (
        <form action={deleteProductForm} className="panel row" style={{ marginTop: 24, borderColor: "#f3c4c4" }}>
          <input type="hidden" name="id" value={product.id} />
          <b style={{ color: "var(--err)" }}>Видалити товар</b>
          <input name="reason" placeholder="Причина (необов'язково)" style={{ flex: 1, minWidth: 200 }} />
          <label className="check">
            <input type="checkbox" required /> так, видалити і в SalesDrive
          </label>
          {stockTotal > 0 && (
            <label className="check">
              <input type="checkbox" name="force" /> на складі ще {stockTotal} шт — все одно видалити
            </label>
          )}
          <button className="btn danger">Видалити</button>
          <span className="muted small" style={{ width: "100%" }}>
            Товар зникне з SalesDrive і з усіх списків. Історія зберігається, а в «Видалених товарах» з'явиться нагадування прибрати його на Prom і
            Horoshop.
          </span>
        </form>
      )}
    </>
  );
}
