import { ua } from "@/lib/names";
import PrintButton from "@/components/PrintButton";
import ProductPhotos from "./ProductPhotos";
import { productImages } from "@/lib/images";
import { getSetting } from "@/lib/util";
import { langIssues } from "@/lib/langcheck";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { dateTimeUa, dateUa, money } from "@/lib/util";
import { MOVE_TYPES } from "@/lib/labels";
import ProductForm from "../ProductForm";
import { promCommissions } from "@/lib/commission";
import { productFormContext } from "@/lib/templates";
import { can, requireUser } from "@/lib/auth";
import { parseParams } from "@/lib/salesdrive";
import { addProductCell, addProductCode, checkFromYml, promProductForm, setMinStock, confirmKitSd, makeBaseForm, deleteProductForm, linkKitForm, removeProductCell, removeProductCode, retryPush, unlinkKit } from "../actions";

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
          <h1 style={{ margin: 0 }}>{ua(product)}</h1>
          <span className="spacer" />
          {can(user, "labels") && (
            <PrintButton className="btn" href={`/print/labels?items=${product.id}:1`}>
              🖨 Наліпка
            </PrintButton>
          )}
          <Link className="btn" href="/products">
            До списку
          </Link>
        </div>
        <ProductPhotos productId={product.id} images={productImages(product.images ?? physical.images)} canEdit={false} />
        {product.base && (
          <div className="msg warn">
            Картка-комплект. Фізично на складі — <b>{ua(product.base)}</b> ({product.base.sku ?? "—"}): шукайте й скануйте наліпку основного товару.
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
                ↳ {ua(k)} <span className="muted">· {k.sku ?? "—"}</span>
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
  const promC = (await promCommissions([product.id])).byProduct.get(product.id) ?? null;
  const inCells = product.cells.reduce((s, c) => s + c.qty, 0);

  const stockTotal = product.stocks.reduce((s, x) => s + x.qty, 0);
  const ymlCheckRaw = await getSetting(`ymlCheck:${product.id}`);
  const promCheckRaw = await getSetting(`promCheck:${product.id}`);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>{ua(product)}</h1>
        <span className="spacer" />
        <PrintButton className="btn" href={`/print/labels?items=${product.id}:1`}>
          🖨 Цінник
        </PrintButton>
        <Link className="btn" href="/products">
          До списку
        </Link>
      </div>
      <ProductPhotos productId={product.id} images={productImages(product.images)} canEdit={!product.deletedAt} />
      {(() => {
        const raw = ymlCheckRaw ? (JSON.parse(ymlCheckRaw) as Record<string, string | null | boolean>) : null;
        return (
          <details className="panel small" id="yml" open={Boolean(raw)}>
            <summary>Що віддає SalesDrive для цього товару (YML)</summary>
            <form action={checkFromYml} style={{ margin: "8px 0" }}>
              <input type="hidden" name="id" value={product.id} />
              <button className="btn sm">Перевірити й оновити з SalesDrive</button>
            </form>
            {raw && !raw.inYml && <div className="msg warn">Товару немає в YML (ID {product.sdId}).</div>}
            {raw && raw.inYml && (
              <table className="small">
                <tbody>
                  {["name", "name_ua", "description", "description_ua", "keywords", "keywords_ua", "tags"].map((k) => (
                    <tr key={k}>
                      <td className="muted">{k}</td>
                      <td>{(raw[k] as string | null) ?? <span style={{ color: "var(--err)" }}>немає тегу</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
        );
      })()}
      {(() => {
        type Side = { name: string | null; keywords: string | null; presence: string | null; qty: number | null };
        const r = promCheckRaw
          ? (JSON.parse(promCheckRaw) as {
              at: string;
              ok: boolean;
              error?: string;
              pushed?: string | null;
              promId?: string;
              ru?: Side;
              uk?: Side;
              fields?: string;
              multilang?: string;
            })
          : null;
        const empty = <span style={{ color: "var(--err)" }}>порожньо</span>;
        return (
          <details className="panel small" id="prom" open={Boolean(r)}>
            <summary>Що зараз на Prom (назва, пошукові запити)</summary>
            <div className="toolbar" style={{ margin: "8px 0" }}>
              <form action={promProductForm}>
                <input type="hidden" name="id" value={product.id} />
                <input type="hidden" name="mode" value="check" />
                <button className="btn sm">Перевірити на Prom</button>
              </form>
              <form action={promProductForm}>
                <input type="hidden" name="id" value={product.id} />
                <input type="hidden" name="mode" value="restore-ru" />
                <button className="btn sm">Повернути російські запити з SalesDrive</button>
              </form>
            </div>
            {r && !r.ok && <div className="msg warn">{r.error}</div>}
            {r?.pushed && <div className="msg ok">{r.pushed}</div>}
            {r?.ok && r.ru && r.uk && (
              <table className="small">
                <tbody>
                  <tr>
                    <td className="muted">Prom ID</td>
                    <td>
                      {r.promId} · {r.uk.presence === "available" ? "є" : "немає"}, {r.uk.qty ?? "—"} шт · перевірено {dateTimeUa(new Date(r.at))}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">Назва RU</td>
                    <td>{r.ru.name ?? empty}</td>
                  </tr>
                  <tr>
                    <td className="muted">Назва UA</td>
                    <td>{r.uk.name ?? empty}</td>
                  </tr>
                  <tr>
                    <td className="muted">Запити</td>
                    <td>
                      {r.ru.keywords || empty}
                      <div className="muted">
                        API Prom віддає й приймає пошукові запити лише однією мовою (російською). Українські — файлом з Налаштувань.
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </details>
        );
      })()}
      {(() => {
        // чого не вистачає в картці (основні товари)
        if (product.baseProductId || product.deletedAt) return null;
        const stockTotal = product.stocks.reduce((s, x) => s + x.qty, 0);
        const miss: [string, string][] = [];
        if (!product.codes.some((c) => c.type === "supplier")) miss.push(["код постачальника", "supcode"]);
        if (!product.categorySdId && !product.categoryName) miss.push(["категорія", "cat"]);
        if (!(product.cost > 0)) miss.push(["собівартість", "cost"]);
        if (!product.manufacturer) miss.push(["бренд", "man"]);
        if (!product.country) miss.push(["країна", "country"]);
        if (!product.keywords) miss.push(["ключові слова", "kw"]);
        if (!product.description) miss.push(["опис", "desc"]);
        if (!product.images || product.images === "[]") miss.push(["фото", "photo"]);
        if (stockTotal > 0 && !product.cells.some((c) => c.qty > 0)) miss.push(["комірка", "cell"]);
        if (!miss.length) return null;
        return (
          <div className="msg warn small">
            <b>Не заповнено:</b>{" "}
            {miss.map(([t, f], i) => (
              <span key={f}>
                {i > 0 && ", "}
                <Link href={`/products/fill?f=${f}`}>{t}</Link>
              </span>
            ))}
          </div>
        );
      })()}
      {langIssues(product).length > 0 && (
        <div className="msg warn small">
          <b>Змішана мова:</b>
          {langIssues(product).map((x) => (
            <div key={x.field}>
              {x.field}: {x.words.join(", ")}
            </div>
          ))}
          <div className="muted">Виправте вручну або кнопками «🌐 перекласти» у формі нижче.</div>
        </div>
      )}

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
          {promC && product.price > 0 && (
            <span
              className="small"
              style={{ display: "block" }}
              title={`Комісія Prom за категорією «${promC.catName ?? "?"}» (Налаштування → Комісії Prom)`}
            >
              з комісією Prom {promC.pct}%: маржа{" "}
              {Math.round(((product.price - product.cost - (product.price * promC.pct) / 100) / product.price) * 100)}% ·{" "}
              {money(product.price - product.cost - (product.price * promC.pct) / 100)} грн
            </span>
          )}
        </div>
      </div>

      {product.base ? (
        <form action={unlinkKit} className="msg warn">
          <input type="hidden" name="kitId" value={product.id} />
          Це <b>картка-комплект</b> (вітрина для сайту). Фізичний товар —{" "}
          <Link href={`/products/${product.base.id}`}>
            <b>{ua(product.base)}</b>
          </Link>{" "}
          ({product.base.sku ?? "—"}){product.kitQty !== 1 ? `, ×${product.kitQty} шт` : ""}. Прихід, комірки, наліпки й інвентаризація ведуться на
          основному товарі; скан цієї картки в документах підставить основний.{" "}
          <button className="btn sm">Відв&apos;язати</button>{" "}
          <button className="btn sm" formAction={makeBaseForm} title="Якщо в SalesDrive фізичний товар — саме ця картка">
            Зробити основним
          </button>
        </form>
      ) : product.kits.length > 0 ? (
        <div className="panel">
          <b>Картки-комплекти цього товару ({product.kits.length})</b> — продаються на сайті під різні моделі, залишок списується з цього товару:
          {product.kits.map((k) => (
            <div key={k.id} className="small" style={{ padding: "2px 0 2px 12px" }}>
              ↳ <Link href={`/products/${k.id}`}>{ua(k)}</Link> <span className="muted">· {k.sku ?? "—"} · {k.price} грн</span>
              {k.sdKitPending && (
                <form action={confirmKitSd} style={{ display: "inline" }}>
                  <input type="hidden" name="kitId" value={k.id} />
                  <input type="hidden" name="back" value={`/products/${product.id}`} />{" "}
                  <span className="badge warn" title="У SalesDrive позначте картку «Комплект» і додайте цей товар">
                    налаштувати в SalesDrive
                  </span>{" "}
                  <button className="btn sm">✓ зроблено</button>
                </form>
              )}
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <Link className="btn sm" href={`/products/${product.id}/cards`}>
              ＋ Ще картки-комплекти
            </Link>
          </div>
        </div>
      ) : (
        <details className="panel">
          <summary className="small">
            Картки-комплекти: <Link href={`/products/${product.id}/cards`}>створити картки під моделі</Link> · або це картка іншого товару? Прив&apos;язати до основного
          </summary>
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


      <ProductForm
        product={product}
        {...ctx}
        kitsCount={product.kits.length}
        supplierCodes={product.codes.filter((c) => c.type === "supplier").map((c) => ({ code: c.code, supplier: c.supplier?.name ?? null }))}
      />

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
          {!product.baseProductId && (
            <form action={setMinStock} className="row" style={{ marginTop: 14 }}>
              <input type="hidden" name="id" value={product.id} />
              <span className="small">Мінімальний залишок:</span>
              <input name="minStock" defaultValue={product.minStock ?? ""} placeholder="авто" inputMode="decimal" style={{ width: 80 }} />
              <button className="btn sm">Зберегти</button>
              <Link className="small" href="/products/reorder?f=sold">
                що дозамовити →
              </Link>
            </form>
          )}
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
