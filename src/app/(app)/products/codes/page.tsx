import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/util";
import { bulkGenerate, saveSkuSettings } from "../actions";

// Штрихкоди й артикули: генерація, шаблон артикула, пошук дублікатів
export default async function CodesPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const [noBarcode, noSku, prefix, digits, dupBarcodes, dupSkus, supplierCodes] = await Promise.all([
    db.product.count({ where: { OR: [{ barcode: null }, { barcode: "" }] } }),
    db.product.count({ where: { OR: [{ sku: null }, { sku: "" }] } }),
    getSetting("skuPrefix"),
    getSetting("skuDigits"),
    db.product.groupBy({ by: ["barcode"], where: { barcode: { not: null } }, _count: { _all: true }, having: { barcode: { _count: { gt: 1 } } } }),
    db.product.groupBy({ by: ["sku"], where: { sku: { not: null } }, _count: { _all: true }, having: { sku: { _count: { gt: 1 } } } }),
    db.productCode.count({ where: { type: "supplier" } }),
  ]);
  const dupCodes = [...dupBarcodes.map((d) => d.barcode!), ...dupSkus.map((d) => d.sku!)].filter(Boolean);
  const dupProducts = dupCodes.length
    ? await db.product.findMany({
        where: { OR: [{ barcode: { in: dupCodes } }, { sku: { in: dupCodes } }] },
        select: { id: true, name: true, sku: true, barcode: true },
        orderBy: { name: "asc" },
      })
    : [];
  const pfx = prefix ?? "ART";
  const dg = Number(digits) || 4;

  return (
    <>
      <h1>Штрихкоди й артикули</h1>
      {msg && <div className={`msg ${msg.startsWith("Помилка") ? "err" : "ok"}`}>{msg}</div>}

      <div className="stats">
        <div className="stat">
          Без штрихкоду
          <b>{noBarcode}</b>
          {noBarcode > 0 && <Link href="/products?nobarcode=1">показати</Link>}
        </div>
        <div className="stat">
          Без артикула
          <b>{noSku}</b>
        </div>
        <div className="stat">
          Артикулів постачальників
          <b>{supplierCodes}</b>
        </div>
        <div className="stat">
          Дублікати кодів
          <b>{dupCodes.length}</b>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Шаблон артикула</h2>
        <p className="small muted">
          Новим товарам артикул генерується як наступний вільний номер: <b>{pfx + "0".repeat(dg - 1) + "1"}</b>, <b>{pfx + "0".repeat(dg - 1) + "2"}</b>… Свій
          артикул завжди можна вписати вручну.
        </p>
        {isAdmin && (
          <form action={saveSkuSettings} className="row">
            <label>
              Префікс
              <input name="prefix" defaultValue={pfx} style={{ width: 100 }} />
            </label>
            <label>
              Цифр
              <input name="digits" type="number" min={3} max={8} defaultValue={dg} style={{ width: 80 }} />
            </label>
            <button className="btn">Зберегти</button>
          </form>
        )}
      </div>

      {isAdmin && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Масова генерація</h2>
          <p className="small muted">
            Штрихкоди генеруються у форматі EAN-13 з префіксом 200 (внутрішні коди магазину, не перетинаються з кодами виробників). Згенеровані коди одразу
            відправляються в SalesDrive.
          </p>
          <div className="row">
            <form action={bulkGenerate}>
              <input type="hidden" name="what" value="barcode" />
              <button className="btn primary" disabled={!noBarcode}>
                Згенерувати штрихкоди ({noBarcode})
              </button>
            </form>
            <form action={bulkGenerate}>
              <input type="hidden" name="what" value="sku" />
              <button className="btn" disabled={!noSku}>
                Згенерувати артикули ({noSku})
              </button>
            </form>
          </div>
        </div>
      )}

      <h2>Дублікати (один код у кількох товарів)</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th>Артикул</th>
              <th>Штрихкод</th>
            </tr>
          </thead>
          <tbody>
            {dupProducts.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/products/${p.id}`}>{p.name}</Link>
                </td>
                <td>{dupCodes.includes(p.sku ?? "") ? <span className="badge warn">{p.sku}</span> : p.sku}</td>
                <td>{dupCodes.includes(p.barcode ?? "") ? <span className="badge warn">{p.barcode}</span> : p.barcode}</td>
              </tr>
            ))}
            {dupProducts.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  Дублікатів немає 👍
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
