import { db } from "@/lib/db";
import { parseParams } from "@/lib/salesdrive";
import { applyBulkParam } from "./actions";

type SP = Promise<{ msg?: string; warn?: string; err?: string }>;

// Масові характеристики: «Стан: Новий», «Країна виробник: Китай» тощо — для всіх товарів одразу
export default async function BulkParamsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const products = await db.product.findMany({ where: { deletedAt: null, sdId: { not: null } }, select: { params: true, categoryName: true, manufacturer: true } });
  // які характеристики є і скільки товарів без них
  const stat = new Map<string, { has: number; values: Map<string, number> }>();
  for (const p of products)
    for (const x of parseParams(p.params)) {
      if (!x.value.trim()) continue;
      const k = x.name.trim();
      const s = stat.get(k) ?? { has: 0, values: new Map<string, number>() };
      s.has++;
      s.values.set(x.value, (s.values.get(x.value) ?? 0) + 1);
      stat.set(k, s);
    }
  const total = products.length;
  const cats = [...new Set(products.map((p) => p.categoryName).filter((c): c is string => Boolean(c)))].sort();
  const noBrand = products.filter((p) => !p.manufacturer).length;
  const rows = [...stat.entries()].sort((a, b) => b[1].has - a[1].has);

  return (
    <>
      <h1>Характеристики масово</h1>
      {sp.msg && <div className="msg ok">{sp.msg}</div>}
      {sp.warn && <div className="msg warn">{sp.warn}</div>}
      {sp.err && <div className="msg err">{sp.err}</div>}
      <p className="muted small">
        Характеристика додається всім товарам (разом із картками-комплектами — вони окремі товари на Prom) і йде в SalesDrive, а звідти з YML на Prom і
        Horoshop. Назву пишіть так, як вона називається на Prom: «Стан», «Країна виробник».
      </p>

      <form action={applyBulkParam} className="panel">
        <div className="row">
          <label>
            Характеристика
            <input name="name" list="pnames" required placeholder="Стан" style={{ width: 200 }} />
            <datalist id="pnames">
              {["Стан", "Країна виробник", ...rows.map(([k]) => k)].map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          </label>
          <label>
            Значення
            <input name="value" required placeholder="Новий" style={{ width: 200 }} />
          </label>
          <label>
            Товари
            <select name="category" defaultValue="">
              <option value="">усі ({total})</option>
              {cats.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Якщо вже є
            <select name="mode" defaultValue="missing">
              <option value="missing">не чіпати (додати лише де немає)</option>
              <option value="replace">замінити значення</option>
            </select>
          </label>
          <button className="btn primary">Застосувати й відправити</button>
        </div>
      </form>

      <div className="stats">
        <div className="stat">
          Товарів (з картками)
          <b>{total}</b>
        </div>
        <div className="stat">
          Без бренду (виробника)
          <b>{noBrand}</b>
        </div>
      </div>
      <p className="small">
        Бренд — окреме поле «Виробник», не характеристика: заповнюйте в «Заповнення даних» → «Без виробника».
      </p>

      <h2>Які характеристики вже є</h2>
      <div className="tablewrap">
        <table className="small">
          <thead>
            <tr>
              <th>Характеристика</th>
              <th className="num">Є у товарів</th>
              <th className="num">Немає</th>
              <th>Найчастіші значення</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, s]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="num">{s.has}</td>
                <td className="num" style={{ color: total - s.has > 0 ? "var(--err)" : undefined }}>
                  {total - s.has}
                </td>
                <td className="muted">
                  {[...s.values.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([v, n]) => `${v} (${n})`)
                    .join(", ")}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Характеристик немає або YML не віддає їх (Налаштування вивантаження YML у SalesDrive → описи й характеристики).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
