import Link from "next/link";
import { db } from "@/lib/db";
import { dateInput, money } from "@/lib/util";

type SP = Promise<{ from?: string; to?: string }>;

// Звіт по приходах за період: по постачальниках і по товарах
export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const now = new Date();
  const from = sp.from ? new Date(sp.from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = sp.to ? new Date(`${sp.to}T23:59:59`) : now;

  const lines = await db.receiptLine.findMany({
    where: { receipt: { status: "posted", date: { gte: from, lte: to } } },
    include: { product: true, receipt: { include: { supplier: true } } },
  });

  const bySupplier = new Map<string, { docs: Set<number>; qty: number; sum: number }>();
  const byProduct = new Map<number, { id: number; name: string; qty: number; sum: number; lastCost: number }>();
  for (const l of lines) {
    const sName = l.receipt.supplier?.name ?? "Без постачальника";
    const s = bySupplier.get(sName) ?? { docs: new Set<number>(), qty: 0, sum: 0 };
    s.docs.add(l.receiptId);
    s.qty += l.qty;
    s.sum += l.qty * l.cost * l.receipt.rate; // у гривні за курсом приходу
    bySupplier.set(sName, s);

    const costUah = l.cost * l.receipt.rate;
    const p = byProduct.get(l.productId) ?? { id: l.productId, name: l.product.name, qty: 0, sum: 0, lastCost: costUah };
    p.qty += l.qty;
    p.sum += l.qty * costUah;
    p.lastCost = costUah;
    byProduct.set(l.productId, p);
  }
  const suppliers = [...bySupplier.entries()].sort((a, b) => b[1].sum - a[1].sum);
  const products = [...byProduct.values()].sort((a, b) => b.sum - a.sum).slice(0, 100);
  const total = suppliers.reduce((s, [, v]) => s + v.sum, 0);
  const docs = new Set(lines.map((l) => l.receiptId)).size;

  return (
    <>
      <h1>Звіт по приходах</h1>
      <form className="panel row">
        <label>
          З
          <input type="date" name="from" defaultValue={dateInput(from)} />
        </label>
        <label>
          По
          <input type="date" name="to" defaultValue={dateInput(to)} />
        </label>
        <button className="btn">Показати</button>
        <a className="btn" href={`/api/receipts/export?status=posted&from=${dateInput(from)}&to=${dateInput(to)}`}>
          ⬇ Детально в Excel (CSV)
        </a>
      </form>

      <div className="stats">
        <div className="stat">
          Документів
          <b>{docs}</b>
        </div>
        <div className="stat">
          Закуплено на суму
          <b>{money(total)}</b>
        </div>
        <div className="stat">
          Різних товарів
          <b>{byProduct.size}</b>
        </div>
      </div>

      <h2>По постачальниках</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Постачальник</th>
              <th className="num">Документів</th>
              <th className="num">Штук</th>
              <th className="num">Сума</th>
              <th className="num">Частка</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map(([name, v]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="num">{v.docs.size}</td>
                <td className="num">{v.qty}</td>
                <td className="num">{money(v.sum)}</td>
                <td className="num">{total ? Math.round((v.sum / total) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Топ товарів за сумою закупівлі</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th className="num">Штук</th>
              <th className="num">Сума</th>
              <th className="num">Остання закупівля</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/products/${p.id}`}>{p.name}</Link>
                </td>
                <td className="num">{p.qty}</td>
                <td className="num">{money(p.sum)}</td>
                <td className="num">{money(p.lastCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
