import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { promRates } from "@/lib/commission";
import { reloadPromCats, saveRates } from "./actions";

export default async function PromCommissionPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await requirePerm("settings");
  const sp = await searchParams;
  const [cats, noCat, rates] = await Promise.all([
    db.promLink.groupBy({ by: ["catId", "catName"], where: { catId: { not: null } }, _count: { _all: true }, orderBy: { catName: "asc" } }),
    db.promLink.count({ where: { catId: null } }),
    promRates(),
  ]);

  return (
    <>
      <p>
        <Link href="/settings">← Налаштування</Link>
      </p>
      <h1>Комісії Prom по категоріях</h1>
      {sp.msg && <div className="msg">{sp.msg}</div>}
      <p className="muted small">
        Комісія Prom залежить від категорії порталу, в якій стоїть товар. Впишіть % з таблиці комісій Prom (кабінет Prom → «Тарифи» / «Комісія за
        замовлення»). Після цього в приході та в картці товару поруч зі звичайною маржею буде маржа з урахуванням комісії Prom. Порожнє поле — без
        комісії.
      </p>

      <form action={reloadPromCats} className="toolbar">
        <button className="btn">⟳ Оновити категорії товарів з Prom</button>
        {noCat > 0 && <span className="small muted">товарів Prom без категорії в додатку: {noCat} — натисніть, щоб підтягнути</span>}
      </form>

      {cats.length === 0 ? (
        <div className="panel muted">Категорій ще немає — натисніть «Оновити категорії товарів з Prom».</div>
      ) : (
        <form action={saveRates} className="panel">
          <table>
            <thead>
              <tr>
                <th>Категорія Prom</th>
                <th className="num" style={{ width: 90 }}>
                  Товарів
                </th>
                <th style={{ width: 130 }}>Комісія, %</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.catId}>
                  <td>
                    {c.catName ?? "—"} <span className="muted small">#{c.catId}</span>
                  </td>
                  <td className="num">{c._count._all}</td>
                  <td>
                    <input name={`r_${c.catId}`} defaultValue={rates[c.catId!] ?? ""} inputMode="decimal" placeholder="напр. 7.5" style={{ width: 100 }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn primary" style={{ marginTop: 10 }}>
            Зберегти ставки
          </button>
        </form>
      )}
    </>
  );
}
