import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { cachedStatuses, ordersEnabled } from "@/lib/orders";
import { dateInput, dateTimeUa, getSetting, money } from "@/lib/util";
import { refreshSales, saveSaleStatuses } from "./actions";

type SP = Promise<{ from?: string; to?: string; msg?: string }>;

// Звіт по продажах на основі заявок SalesDrive
export default async function SalesReport({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await requireUser();
  const now = new Date();
  const from = sp.from ? new Date(sp.from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = sp.to ? new Date(`${sp.to}T23:59:59`) : now;
  const enabled = ordersEnabled();
  const [statuses, saleStatusesRaw, lastSync] = await Promise.all([cachedStatuses(), getSetting("saleStatuses"), getSetting("lastOrderSync")]);
  const savedSale: number[] = saleStatusesRaw ? JSON.parse(saleStatusesRaw) : [];
  // якщо не налаштовано — рахуємо продажем статус «Продано» (поки посилку не отримали, це ще не продаж)
  const autoSale = savedSale.length ? [] : statuses.filter((s) => /прода[нж]/i.test(s.name)).map((s) => s.id);
  const saleStatuses: number[] = savedSale.length ? savedSale : autoSale;
  const statusFilter = saleStatuses.length ? { statusId: { in: saleStatuses } } : {};

  const [orders, lines, expenses] = await Promise.all([
    db.sdOrder.aggregate({
      where: { orderTime: { gte: from, lte: to }, ...statusFilter },
      _sum: { amount: true, costAmount: true, profit: true },
      _count: true,
    }),
    db.sdOrderLine.findMany({
      where: { order: { orderTime: { gte: from, lte: to }, ...statusFilter } },
      include: {
        product: {
          select: { id: true, name: true, cost: true, categoryName: true, kitQty: true, base: { select: { id: true, name: true, cost: true, categoryName: true } } },
        },
      },
    }),
    db.expense.groupBy({ by: ["kind", "category"], where: { date: { gte: from, lte: to } }, _sum: { amount: true } }),
  ]);
  const bizExp = expenses.filter((e) => e.kind === "expense");
  const otherIncome = expenses.filter((e) => e.kind === "income").reduce((s, e) => s + (e._sum.amount ?? 0), 0);
  const ownerOut = expenses.filter((e) => e.kind === "owner").reduce((s, e) => s + (e._sum.amount ?? 0), 0);
  const expTotal = bizExp.reduce((s, e) => s + (e._sum.amount ?? 0), 0);
  const gross = orders._sum.profit ?? 0;
  const net = gross + otherIncome - expTotal;

  // По товарах: продажі карток-комплектів зводимо на основний (фізичний) товар, у штуках основного
  const byProduct = new Map<string, { id: number | null; name: string; category: string; qty: number; revenue: number; cost: number; cards: number }>();
  for (const l of lines) {
    const base = l.product?.base ?? null;
    const target = base ?? l.product;
    const mult = base ? l.product?.kitQty || 1 : 1;
    const key = target ? `p${target.id}` : `n${l.name}`;
    const unitCost = l.costPrice || (base ? base.cost * mult : l.product?.cost) || 0;
    const x = byProduct.get(key) ?? {
      id: target?.id ?? null,
      name: target?.name ?? l.name,
      category: target?.categoryName ?? "Без категорії",
      qty: 0,
      revenue: 0,
      cost: 0,
      cards: 0,
    };
    if (base) x.cards += l.qty;
    x.qty += l.qty * mult;
    x.revenue += l.qty * l.price - l.discount;
    x.cost += l.qty * unitCost;
    byProduct.set(key, x);
  }
  const top = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue);
  const byCategory = new Map<string, { qty: number; revenue: number; profit: number }>();
  for (const x of top) {
    const c = byCategory.get(x.category) ?? { qty: 0, revenue: 0, profit: 0 };
    c.qty += x.qty;
    c.revenue += x.revenue;
    c.profit += x.revenue - x.cost;
    byCategory.set(x.category, c);
  }

  // Що закупити: швидкість продажів за 30 днів vs залишок
  const since30 = new Date(Date.now() - 30 * 864e5);
  const [sold30Raw, stocks] = await Promise.all([
    db.sdOrderLine.groupBy({
      by: ["productId"],
      where: { productId: { not: null }, order: { orderTime: { gte: since30 }, ...statusFilter } },
      _sum: { qty: true },
    }),
    // залишок — лише фізичних (основних) товарів; картки-комплекти дублюють залишок основного
    db.stockBalance.groupBy({ by: ["productId"], where: { product: { deletedAt: null, baseProductId: null } }, _sum: { qty: true } }),
  ]);
  // продажі карток-комплектів зараховуємо основному товару
  const kitRows = await db.product.findMany({
    where: { id: { in: sold30Raw.map((x) => x.productId!) }, baseProductId: { not: null } },
    select: { id: true, baseProductId: true, kitQty: true },
  });
  const kitOf = new Map<number, { baseProductId: number | null; kitQty: number }>(kitRows.map((k) => [k.id, k]));
  const soldAgg = new Map<number, number>();
  for (const x of sold30Raw) {
    const k = kitOf.get(x.productId!);
    const id = k?.baseProductId ?? x.productId!;
    soldAgg.set(id, (soldAgg.get(id) ?? 0) + (x._sum.qty ?? 0) * (k?.kitQty || 1));
  }
  const sold30 = [...soldAgg.entries()].map(([productId, qty]) => ({ productId, _sum: { qty } }));
  const stockMap = new Map<number, number>(stocks.map((s) => [s.productId, s._sum.qty ?? 0]));
  const soldMap = new Map<number, number>(sold30.map((s) => [s.productId!, s._sum.qty ?? 0]));
  const buyIds = sold30
    .map((s) => ({ id: s.productId!, sold: s._sum.qty ?? 0, stock: stockMap.get(s.productId!) ?? 0 }))
    .filter((x) => x.sold > 0 && x.stock / (x.sold / 30) < 14) // вистачить менше ніж на 2 тижні
    .sort((a, b) => a.stock / a.sold - b.stock / b.sold)
    .slice(0, 50);
  // Неліквід: є на складі, але не продавалось 30 днів
  const deadIds = stocks.filter((s) => (s._sum.qty ?? 0) > 0 && !soldMap.get(s.productId)).map((s) => s.productId);
  const [buyProducts, deadProducts] = await Promise.all([
    db.product.findMany({ where: { id: { in: buyIds.map((b) => b.id) } }, select: { id: true, name: true, sku: true } }),
    db.product.findMany({ where: { id: { in: deadIds } }, select: { id: true, name: true, sku: true, cost: true } }),
  ]);
  const dead = deadProducts
    .map((p) => ({ ...p, stock: stockMap.get(p.id) ?? 0, value: (stockMap.get(p.id) ?? 0) * p.cost }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 50);
  const nameOf = new Map<number, { id: number; name: string; sku: string | null }>(buyProducts.map((p) => [p.id, p]));

  return (
    <>
      <h1>Звіт по продажах</h1>
      {sp.msg && <div className={`msg ${sp.msg.startsWith("Помилка") ? "err" : "ok"}`}>{sp.msg}</div>}
      {!enabled && (
        <div className="msg warn">
          Щоб бачити продажі, створіть у SalesDrive окремий API-ключ лише з правами «Заявки: читання» і «Статуси заявки: читання» та додайте його в
          змінну SALESDRIVE_ORDERS_KEY. Дані клієнтів додаток не зберігає.
        </div>
      )}

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
        <span className="spacer" />
        <span className="muted small">Оновлено: {lastSync ? dateTimeUa(new Date(lastSync)) : "ще ні"}</span>
        <button className="btn" formAction={refreshSales} disabled={!enabled}>
          ⟳ Оновити з SalesDrive
        </button>
      </form>

      <div className="stats">
        <div className="stat">
          Заявок
          <b>{orders._count}</b>
        </div>
        <div className="stat">
          Виручка
          <b>{money(orders._sum.amount)}</b>
        </div>
        <div className="stat">
          Собівартість
          <b>{money(orders._sum.costAmount)}</b>
        </div>
        <div className="stat">
          Прибуток (за SalesDrive)
          <b>{money(orders._sum.profit)}</b>
          <span className="muted small">
            {orders._sum.amount ? Math.round(((orders._sum.profit ?? 0) / orders._sum.amount) * 100) : 0}% від виручки
          </span>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Чистий прибуток за період</h2>
        <table className="small" style={{ maxWidth: 520 }}>
          <tbody>
            <tr>
              <td>Виручка</td>
              <td className="num">{money(orders._sum.amount)}</td>
            </tr>
            <tr>
              <td>− Собівартість проданого</td>
              <td className="num">{money(orders._sum.costAmount)}</td>
            </tr>
            <tr>
              <td>
                <b>= Валовий прибуток</b>
              </td>
              <td className="num">
                <b>{money(gross)}</b>
              </td>
            </tr>
            {otherIncome > 0 && (
              <tr>
                <td>+ Інші доходи</td>
                <td className="num">{money(otherIncome)}</td>
              </tr>
            )}
            {bizExp
              .sort((a, b) => (b._sum.amount ?? 0) - (a._sum.amount ?? 0))
              .map((e) => (
                <tr key={e.category}>
                  <td>− {e.category}</td>
                  <td className="num">{money(e._sum.amount)}</td>
                </tr>
              ))}
            {bizExp.length === 0 && (
              <tr>
                <td colSpan={2} className="muted">
                  − Витрат за період не внесено. <Link href="/reports/expenses">Внести рекламу й інші витрати</Link>
                </td>
              </tr>
            )}
            <tr>
              <td>
                <b>= Чистий прибуток</b>
              </td>
              <td className="num">
                <b style={{ color: net < 0 ? "#b91c1c" : undefined }}>{money(net)}</b>
              </td>
            </tr>
            {ownerOut > 0 && (
              <tr>
                <td className="muted">Виведено власником / особисте (не витрата бізнесу)</td>
                <td className="num muted">{money(ownerOut)}</td>
              </tr>
            )}
            {orders._count > 0 && expTotal > 0 && (
              <tr>
                <td className="muted">Витрати на 1 продаж</td>
                <td className="num muted">{money(expTotal / orders._count)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Продаж — заявка в статусі продажу, місяць — за датою створення заявки. Закупівлі сюди не входять: товар стає витратою, коли проданий
          (собівартість у заявці). Увесь рух грошей, з закупівлями й виведеним — у «Гроші за місяць».
        </p>
      </div>

      <h2>Топ товарів</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th className="num">Продано, шт</th>
              <th className="num">Виручка</th>
              <th className="num">Маржа</th>
              <th className="num">Маржа, %</th>
            </tr>
          </thead>
          <tbody>
            {top.slice(0, 100).map((x, i) => (
              <tr key={i}>
                <td>
                  {x.id ? <Link href={`/products/${x.id}`}>{x.name}</Link> : <span title="не зіставлено з товаром">{x.name} ⚠</span>}
                  {x.cards > 0 && <span className="muted small"> · з них через картки-комплекти: {x.cards}</span>}
                </td>
                <td className="num">{x.qty}</td>
                <td className="num">{money(x.revenue)}</td>
                <td className="num">{money(x.revenue - x.cost)}</td>
                <td className="num">{x.revenue ? Math.round(((x.revenue - x.cost) / x.revenue) * 100) : 0}%</td>
              </tr>
            ))}
            {top.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Немає продажів за період
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>По категоріях</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Категорія</th>
              <th className="num">Шт</th>
              <th className="num">Виручка</th>
              <th className="num">Маржа</th>
            </tr>
          </thead>
          <tbody>
            {[...byCategory.entries()]
              .sort((a, b) => b[1].revenue - a[1].revenue)
              .map(([name, c]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="num">{c.qty}</td>
                  <td className="num">{money(c.revenue)}</td>
                  <td className="num">{money(c.profit)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Що закупити</h2>
          <p className="muted small">Продається, а залишку вистачить менше ніж на 2 тижні (за темпом останніх 30 днів).</p>
          <div className="tablewrap">
            <table className="small">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th className="num">Залишок</th>
                  <th className="num">Продано/30 дн</th>
                  <th className="num">На днів</th>
                </tr>
              </thead>
              <tbody>
                {buyIds.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/products/${b.id}`}>{nameOf.get(b.id)?.name ?? b.id}</Link>
                    </td>
                    <td className="num">{b.stock}</td>
                    <td className="num">{b.sold}</td>
                    <td className="num">{Math.floor(b.stock / (b.sold / 30))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 style={{ marginTop: 0 }}>Неліквід</h2>
          <p className="muted small">Є на складі, але не продавалося 30 днів. Відсортовано за сумою собівартості.</p>
          <div className="tablewrap">
            <table className="small">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th className="num">Залишок</th>
                  <th className="num">Заморожено</th>
                </tr>
              </thead>
              <tbody>
                {dead.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/products/${d.id}`}>{d.name}</Link>
                    </td>
                    <td className="num">{d.stock}</td>
                    <td className="num">{money(d.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {user.role === "admin" && statuses.length > 0 && (
        <form action={saveSaleStatuses} className="panel" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Які статуси вважати продажем</h2>
          <p className="muted small">
            {autoSale.length
              ? "Зараз автоматично рахується статус «Продано». Можна обрати інші."
              : "Не позначено нічого — рахуються всі заявки, крім видалених."}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
            {statuses.map((s) => (
              <label key={s.id} className="check">
                <input type="checkbox" name="status" value={s.id} defaultChecked={saleStatuses.includes(s.id)} /> {s.name}
              </label>
            ))}
          </div>
          <button className="btn" style={{ marginTop: 10 }}>
            Зберегти
          </button>
        </form>
      )}
    </>
  );
}
