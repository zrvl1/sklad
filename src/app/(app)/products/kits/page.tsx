import { ua } from "@/lib/names";
import Link from "next/link";
import { db } from "@/lib/db";
import { detectKits } from "@/lib/kits";
import { alignKitPrices, applyKitLinks, confirmKitSd, makeBaseForm, unlinkKit } from "../actions";

// Основні товари та їхні картки-комплекти (вітрини під різні моделі для SEO)
export default async function KitsPage({ searchParams }: { searchParams: Promise<{ msg?: string; warn?: string }> }) {
  const { msg: okMsg, warn } = await searchParams;
  const [proposals, bases, pending] = await Promise.all([
    detectKits(),
    db.product.findMany({
      where: { deletedAt: null, kits: { some: { deletedAt: null } } },
      include: { kits: { where: { deletedAt: null }, orderBy: { sku: "asc" } }, stocks: true, cells: { include: { cell: true } } },
      orderBy: { name: "asc" },
    }),
    db.product.findMany({
      where: { sdKitPending: true, deletedAt: null, baseProductId: { not: null } },
      include: { base: { select: { id: true, name: true, nameTranslate: true, sku: true } } },
      orderBy: { sku: "asc" },
    }),
  ]);
  const kitCount = bases.reduce((s, b) => s + b.kits.length, 0);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Основні товари й картки-комплекти</h1>
        <span className="spacer" />
        <form action={alignKitPrices}>
          <button className="btn" title="Ціна кожної картки = ціна основного товару × кількість у картці; передається в SalesDrive">
            Вирівняти ціни карток за основними
          </button>
        </form>
        <Link className="btn primary" href="/products/import">
          Звірити з Excel SalesDrive
        </Link>
      </div>
      {okMsg && <div className="msg ok">{okMsg}</div>}
      {warn && <div className="msg warn">{warn}</div>}

      {pending.length > 0 && (
        <form action={confirmKitSd} className="panel" id="pending" style={{ borderColor: "#f0c36d" }}>
          <input type="hidden" name="back" value="/products/kits" />
          <h2 style={{ marginTop: 0 }}>Налаштувати в SalesDrive ({pending.length})</h2>
          <p className="small muted">
            Ці картки створено в додатку. У SalesDrive відкрийте кожну (пошук за артикулом) → поставте галочку <b>«Комплект»</b> → додайте основний товар
            і кількість → збережіть. Після наступної синхронізації додаток сам побачить, що залишок картки дорівнює залишку основного, і прибере її зі
            списку (якщо основного зараз 0 — позначте вручну).
          </p>
          <div className="tablewrap">
            <table className="small">
              <thead>
                <tr>
                  <th style={{ width: 30 }} />
                  <th>Картка (артикул · ID)</th>
                  <th>Додати в комплект</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <input type="checkbox" name="kitId" value={k.id} />
                    </td>
                    <td>
                      <b>{k.sku}</b> · {k.sdId} — <Link href={`/products/${k.id}`}>{ua(k)}</Link>
                    </td>
                    <td>
                      <b>{k.base?.sku}</b> × {k.kitQty} — {k.base ? ua(k.base) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn" style={{ marginTop: 10 }}>
            ✓ Позначені вже налаштовано
          </button>
        </form>
      )}
      <p className="muted small">
        Один фізичний товар у SalesDrive зібраний у кілька карток під різні моделі. Прихід, комірки, наліпки, інвентаризація і списання ведуться лише на
        <b> основному</b> товарі: скан штрихкоду чи артикула будь-якої картки автоматично підставляє основний. Під час пакування наліпка основного
        товару підходить до замовлення на будь-яку його картку. Нова ціна основного товару переноситься на всі картки.
      </p>

      <div className="stats">
        <div className="stat">
          Основних товарів із картками
          <b>{bases.length}</b>
        </div>
        <div className="stat">
          Прив&apos;язаних карток
          <b>{kitCount}</b>
        </div>
        <div className="stat">
          Знайдено за артикулом
          <b>{proposals.length}</b>
        </div>
      </div>

      {proposals.length > 0 && (
        <form action={applyKitLinks} className="panel">
          <h2 style={{ marginTop: 0 }}>Знайдено автоматично за артикулом</h2>
          <p className="muted small">
            Картка з артикулом <b>XXX-1</b>, <b>XXX-2</b>… прив&apos;язується до товару з артикулом <b>XXX</b>. Перевірте й зніміть галочки там, де це не так.
            ⚠ — залишки картки й основного різняться: можливо, це не комплект, а окремий товар.
          </p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 30 }} />
                  <th>Картка</th>
                  <th>→ Основний товар</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.kit.id}>
                    <td>
                      <input type="checkbox" name="pair" value={`${p.kit.id}:${p.base.id}`} defaultChecked={p.stockMatch} />
                    </td>
                    <td>
                      <Link href={`/products/${p.kit.id}`}>{p.kit.name}</Link>
                      <div className="muted small">
                        {p.kit.sku} · залишок {p.kit.stocks.reduce((s, x) => s + x.qty, 0)}
                      </div>
                    </td>
                    <td>
                      {!p.stockMatch && <span title="Залишки різняться">⚠ </span>}
                      <Link href={`/products/${p.base.id}`}>{ua(p.base)}</Link>
                      <div className="muted small">
                        {p.base.sku} · залишок {p.base.stocks.reduce((s, x) => s + x.qty, 0)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn primary" style={{ marginTop: 12 }}>
            Прив&apos;язати позначені
          </button>
        </form>
      )}

      <p className="muted small">
        Картки з іншими артикулами прив&apos;язуються вручну: відкрийте картку товару → блок «Картка-комплект» → вкажіть артикул або штрихкод основного.
      </p>

      <h2>Прив&apos;язані</h2>
      {bases.map((b) => (
        <div key={b.id} className="panel">
          <div className="toolbar" style={{ marginBottom: 6 }}>
            <Link href={`/products/${b.id}`}>
              <b>{ua(b)}</b>
            </Link>
            <span className="muted small">
              {b.sku} · ш/к {b.barcode ?? "—"} · залишок {b.stocks.reduce((s, x) => s + x.qty, 0)} · комірки{" "}
              {b.cells.filter((c) => c.qty > 0).map((c) => c.cell.code).join(", ") || "—"}
            </span>
          </div>
          {b.kits.map((k) => (
            <form key={k.id} action={unlinkKit} className="row small" style={{ justifyContent: "space-between", padding: "3px 0 3px 16px" }}>
              <input type="hidden" name="kitId" value={k.id} />
              <input type="hidden" name="back" value="/products/kits" />
              <span>
                ↳ <Link href={`/products/${k.id}`}>{ua(k)}</Link> <span className="muted">· {k.sku ?? "—"} · {k.price} грн{k.kitQty !== 1 ? ` · ×${k.kitQty}` : ""}</span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <button className="btn sm" formAction={makeBaseForm} title="У SalesDrive фізичний товар — саме ця картка">
                  зробити основним
                </button>
                <button className="btn sm" title="Відв'язати картку">
                  відв&apos;язати
                </button>
              </span>
            </form>
          ))}
        </div>
      ))}
      {bases.length === 0 && <p className="muted">Ще немає прив&apos;язаних карток.</p>}
    </>
  );
}
