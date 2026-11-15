import Link from "next/link";
import { db } from "@/lib/db";
import { dateInput, dateUa, money } from "@/lib/util";
import { addExpense, deleteExpense } from "./actions";

const EXPENSE_CATEGORIES = ["Google Ads", "Prom: ProSale (реклама)", "Prom: комісія за замовлення", "Prom: тариф / пакет", "Horoshop: тариф", "Facebook / Instagram", "Доставка за наш рахунок", "Пакування", "Зарплата", "Сервіси (CRM, Checkbox, хостинг)", "Інше"];

type SP = Promise<{ month?: string; msg?: string; err?: string }>;

// Витрати за місяць: реклама, комісії, сервіси — для чистого прибутку у «Звіт: продажі»
export default async function ExpensesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const now = new Date();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [y, m] = month.split("-").map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 1);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;

  const [rows, used] = await Promise.all([
    db.expense.findMany({ where: { date: { gte: from, lt: to } }, orderBy: { date: "desc" }, include: { createdBy: { select: { name: true } } } }),
    db.expense.findMany({ distinct: ["category"], select: { category: true } }),
  ]);
  const byCat = new Map<string, number>();
  for (const r of rows) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amount);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const cats = [...new Set([...EXPENSE_CATEGORIES, ...used.map((u) => u.category)])];
  const defDate = month === dateInput(now).slice(0, 7) ? dateInput(now) : dateInput(new Date(y, m, 0));

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Витрати</h1>
        <span className="spacer" />
        <Link className="btn sm" href={`/reports/expenses?month=${prev}`}>
          ←
        </Link>
        <b>{from.toLocaleDateString("uk-UA", { month: "long", year: "numeric" })}</b>
        <Link className="btn sm" href={`/reports/expenses?month=${next}`}>
          →
        </Link>
        <Link className="btn" href={`/reports/sales?from=${dateInput(from)}&to=${dateInput(new Date(y, m, 0))}`}>
          Прибуток за місяць
        </Link>
      </div>
      {sp.msg && <div className="msg ok">{sp.msg}</div>}
      {sp.err && <div className="msg err">{sp.err}</div>}
      <p className="muted small">
        Вносьте те, що реально <b>витрачено</b> за місяць (дивіться статистику Google Ads, Prom), а не поповнення рахунку: гроші на балансі реклами ще не
        витрата. Закупівля товару сюди не йде — вона стає собівартістю, коли товар продано.
      </p>

      <form action={addExpense} className="panel row">
        <label>
          Дата
          <input type="date" name="date" defaultValue={defDate} required />
        </label>
        <label>
          Стаття
          <input name="category" list="exp-cats" required placeholder="оберіть або впишіть" style={{ width: 240 }} />
          <datalist id="exp-cats">
            {cats.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label>
          Сума, грн
          <input name="amount" type="number" min={0.01} step="0.01" required style={{ width: 120 }} />
        </label>
        <label>
          Примітка
          <input name="note" placeholder="напр. 1–15 листопада" />
        </label>
        <button className="btn primary">Додати</button>
      </form>

      <div className="stats">
        <div className="stat">
          Усього за місяць
          <b>{money(total)}</b>
        </div>
        {[...byCat.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([c, v]) => (
            <div key={c} className="stat">
              {c}
              <b>{money(v)}</b>
            </div>
          ))}
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Стаття</th>
              <th className="num">Сума</th>
              <th>Примітка</th>
              <th>Додав</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{dateUa(r.date)}</td>
                <td>{r.category}</td>
                <td className="num">{money(r.amount)}</td>
                <td className="small">{r.note}</td>
                <td className="small muted">{r.createdBy.name}</td>
                <td>
                  <form action={deleteExpense}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="month" value={month} />
                    <button className="btn sm" title="Видалити">
                      ×
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  За цей місяць витрат ще немає
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
