import Link from "next/link";
import { db } from "@/lib/db";
import { detectKits } from "@/lib/kits";
import { applyKitLinks, unlinkKit } from "../actions";

// Основні товари та їхні картки-комплекти (вітрини під різні моделі для SEO)
export default async function KitsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const [proposals, bases] = await Promise.all([
    detectKits(),
    db.product.findMany({
      where: { deletedAt: null, kits: { some: { deletedAt: null } } },
      include: { kits: { where: { deletedAt: null }, orderBy: { sku: "asc" } }, stocks: true, cells: { include: { cell: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  const kitCount = bases.reduce((s, b) => s + b.kits.length, 0);

  return (
    <>
      <h1>Основні товари й картки-комплекти</h1>
      {msg && <div className={`msg ${msg.includes("Помилки") ? "warn" : "ok"}`}>{msg}</div>}
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
                      <Link href={`/products/${p.base.id}`}>{p.base.name}</Link>
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
              <b>{b.name}</b>
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
                ↳ <Link href={`/products/${k.id}`}>{k.name}</Link> <span className="muted">· {k.sku ?? "—"} · {k.price} грн{k.kitQty !== 1 ? ` · ×${k.kitQty}` : ""}</span>
              </span>
              <button className="btn sm" title="Відв'язати картку">
                відв&apos;язати
              </button>
            </form>
          ))}
        </div>
      ))}
      {bases.length === 0 && <p className="muted">Ще немає прив&apos;язаних карток.</p>}
    </>
  );
}
