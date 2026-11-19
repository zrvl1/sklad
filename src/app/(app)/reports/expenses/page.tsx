import Link from "next/link";
import { db } from "@/lib/db";
import { MONEY_KINDS, type MoneyKind } from "@/lib/finance-consts";
import { ensureStockSnapshot, monthSummary, stockSnapshot, stockValueNow } from "@/lib/finance";
import { dateInput, dateUa, money } from "@/lib/util";
import { deleteExpense } from "./actions";
import MoneyForm from "./MoneyForm";

type SP = Promise<{ month?: string; kind?: string; msg?: string; err?: string }>;

// Гроші за місяць: прибуток, рух коштів, витрати, виведене власником
export default async function MoneyPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : cur;
  const [y, m] = month.split("-").map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 1);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  const defKind = (sp.kind && sp.kind in MONEY_KINDS ? sp.kind : "expense") as MoneyKind;

  if (month === cur) await ensureStockSnapshot(now);
  const [stockStart, stockEndSnap, stockNow] = await Promise.all([stockSnapshot(month), stockSnapshot(next), month === cur ? stockValueNow() : null]);
  const stockEnd = stockNow ?? stockEndSnap;
  const [rows, usedRaw, s] = await Promise.all([
    db.expense.findMany({ where: { date: { gte: from, lt: to } }, orderBy: { date: "desc" }, include: { createdBy: { select: { name: true } } } }),
    db.expense.findMany({ distinct: ["kind", "category"], select: { kind: true, category: true } }),
    monthSummary(from, to),
  ]);
  const used: Record<string, string[]> = {};
  for (const u of usedRaw) (used[u.kind] ??= []).push(u.category);
  const byCat = new Map<string, number>();
  for (const r of rows.filter((r) => r.kind === "expense")) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amount);
  const defDate = month === cur ? dateInput(now) : dateInput(new Date(y, m, 0));
  const red = (v: number) => (v < 0 ? { color: "var(--err)" } : undefined);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Гроші за місяць</h1>
        <span className="spacer" />
        <Link className="btn sm" href={`/reports/expenses?month=${prev}`}>
          ←
        </Link>
        <b>{from.toLocaleDateString("uk-UA", { month: "long", year: "numeric" })}</b>
        <Link className="btn sm" href={`/reports/expenses?month=${next}`}>
          →
        </Link>
        <Link className="btn" href={`/reports/sales?from=${dateInput(from)}&to=${dateInput(new Date(y, m, 0))}`}>
          Продажі за місяць
        </Link>
      </div>
      {sp.msg && <div className="msg ok">{sp.msg}</div>}
      {sp.err && <div className="msg err">{sp.err}</div>}

      <div className="grid2">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Прибуток</h2>
          <table className="small">
            <tbody>
              <tr>
                <td>Продажі ({s.sales} заявок)</td>
                <td className="num">{money(s.revenue)}</td>
              </tr>
              <tr>
                <td>− Собівартість проданого</td>
                <td className="num">{money(s.cogs)}</td>
              </tr>
              {s.commission > 0 && (
                <tr>
                  <td>− Комісія Prom</td>
                  <td className="num">{money(s.commission)}</td>
                </tr>
              )}
              <tr>
                <td>
                  <b>= Валовий прибуток</b>
                </td>
                <td className="num">
                  <b>{money(s.gross)}</b>
                </td>
              </tr>
              {s.income > 0 && (
                <tr>
                  <td>+ Інші доходи</td>
                  <td className="num">{money(s.income)}</td>
                </tr>
              )}
              <tr>
                <td>− Витрати бізнесу</td>
                <td className="num">{money(s.expense)}</td>
              </tr>
              <tr>
                <td>
                  <b>= Чистий прибуток</b>
                </td>
                <td className="num">
                  <b style={red(s.net)}>{money(s.net)}</b>
                </td>
              </tr>
              <tr>
                <td className="muted">Виведено собі / особисте</td>
                <td className="num muted">{money(s.owner)}</td>
              </tr>
              <tr>
                <td>Лишилось у бізнесі з прибутку</td>
                <td className="num" style={red(s.net - s.owner)}>
                  {money(s.net - s.owner)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Прибуток — з проданого товару. Закупівля — не витрата, а товар на складі: витратою він стає, коли продається.
          </p>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Рух грошей</h2>
          <table className="small">
            <tbody>
              <tr>
                <td>+ Продажі</td>
                <td className="num">{money(s.revenue)}</td>
              </tr>
              {s.income > 0 && (
                <tr>
                  <td>+ Інші доходи</td>
                  <td className="num">{money(s.income)}</td>
                </tr>
              )}
              {s.invest > 0 && (
                <tr>
                  <td>+ Вклав власні</td>
                  <td className="num">{money(s.invest)}</td>
                </tr>
              )}
              <tr>
                <td>
                  − Закупівлі товару ({s.receipts} <Link href="/reports">приходів</Link>)
                </td>
                <td className="num">{money(s.purchases)}</td>
              </tr>
              {s.commission > 0 && (
                <tr>
                  <td>− Комісія Prom</td>
                  <td className="num">{money(s.commission)}</td>
                </tr>
              )}
              <tr>
                <td>− Витрати бізнесу</td>
                <td className="num">{money(s.expense)}</td>
              </tr>
              <tr>
                <td>− Виведено собі / особисте</td>
                <td className="num">{money(s.owner)}</td>
              </tr>
              <tr>
                <td>
                  <b>= Різниця за місяць</b>
                </td>
                <td className="num">
                  <b style={red(s.cashNet)}>{money(s.cashNet)}</b>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Скільки грошей прийшло і пішло. Мінус при плюсовому прибутку — нормально, якщо гроші вкладено в товар (закупівлі).
          </p>
        </div>
      </div>

      <div className="panel small">
        <b>Склад за собівартістю:</b> на 1 число — {stockStart ? <b>{money(stockStart.value)}</b> : <span className="muted">не знято</span>}
        {" · "}
        {month === cur ? "зараз" : "на кінець місяця"} — {stockEnd ? <b>{money(stockEnd.value)}</b> : <span className="muted">не знято</span>}
        {stockStart && stockEnd && (
          <>
            {" · "}зміна{" "}
            <b style={red(stockEnd.value - stockStart.value)}>
              {stockEnd.value - stockStart.value >= 0 ? "+" : ""}
              {money(stockEnd.value - stockStart.value)}
            </b>
          </>
        )}
        {stockEnd && stockEnd.noCost > 0 && <span className="muted"> · без собівартості {stockEnd.noCost} шт (не пораховано)</span>}
        <div className="muted">
          Знімок робиться сам 1-го числа. Гроші «в товарі»: якщо склад виріс, частина прибутку лежить на полицях, а не на рахунку.
        </div>
      </div>

      <MoneyForm defDate={defDate} defKind={defKind} used={used} />
      <p className="muted small">
        Рекламу вносьте за фактом <b>витраченого</b> (статистика Google Ads, Prom), а не поповнення балансу. Закупівлі товару сюди не вносьте — вони
        беруться з приходів.
      </p>

      {byCat.size > 0 && (
        <div className="stats">
          {[...byCat.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([c, v]) => (
              <div key={c} className="stat">
                {c}
                <b>{money(v)}</b>
              </div>
            ))}
        </div>
      )}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Тип</th>
              <th>Стаття</th>
              <th className="num">Сума</th>
              <th>Рахунок</th>
              <th>Примітка</th>
              <th>Записав</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const k = MONEY_KINDS[r.kind as MoneyKind] ?? MONEY_KINDS.expense;
              return (
                <tr key={r.id}>
                  <td>{dateUa(r.date)}</td>
                  <td className="small">{k.title}</td>
                  <td>{r.category}</td>
                  <td className="num" style={{ color: k.sign > 0 ? "var(--ok)" : undefined }}>
                    {k.sign > 0 ? "+" : "−"}
                    {money(r.amount)}
                  </td>
                  <td className="small">{r.account}</td>
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
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  За цей місяць записів ще немає
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
