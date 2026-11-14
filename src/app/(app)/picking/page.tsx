import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { cachedStatuses, ordersEnabled } from "@/lib/orders";
import { dateTimeUa, getSetting } from "@/lib/util";
import { refreshPicking, savePickStatuses } from "./actions";
import { unpack } from "./pack/actions";
import { pickStatusIds } from "@/lib/picking";
import { baseMap } from "@/lib/kits";
import PrintButton from "./PrintButton";

type SP = Promise<{ o?: string | string[]; msg?: string; packed?: string }>;

/**
 * Лист збирання: товари із заявок SalesDrive, згруповані за комірками й відсортовані маршрутом по складу.
 * Обробка заявок, ТТН і SMS — у SalesDrive; тут лише «що і звідки взяти».
 */
export default async function PickingPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await requireUser();
  const enabled = ordersEnabled();
  const [statuses, pickSt, lastSync] = await Promise.all([cachedStatuses(), pickStatusIds(), getSetting("lastOrderSync")]);
  const pick = pickSt.ids;
  const showPacked = sp.packed === "1";
  const statusName = new Map(statuses.map((s) => [s.id, s.name]));

  const orders = pick.length
    ? await db.sdOrder.findMany({
        // запаковані в додатку не показуємо (вони вже чекають на пошту)
        where: { statusId: { in: pick }, orderTime: { gte: new Date(Date.now() - 30 * 864e5) }, ...(showPacked ? {} : { pack: null }) },
        include: { lines: true, ttns: true, pack: true },
        orderBy: { orderTime: "asc" },
        take: 300,
      })
    : [];
  const packedCount = pick.length ? await db.sdOrder.count({ where: { statusId: { in: pick }, pack: { isNot: null } } }) : 0;
  const selected = sp.o ? ([] as string[]).concat(sp.o).map(Number).filter(Boolean) : orders.filter((o) => !o.pack).map((o) => o.id);
  const chosen = orders.filter((o) => selected.includes(o.id));

  // Агрегуємо товари з обраних заявок
  type Need = { productId: number | null; name: string; sku: string | null; qty: number; orders: number[] };
  const need = new Map<string, Need>();
  // картки-комплекти збираємо як основний товар (з його комірок)
  const toBase = await baseMap(chosen.flatMap((o) => o.lines.map((l) => l.productId)).filter((x): x is number => x !== null));
  for (const o of chosen)
    for (const raw of o.lines) {
      const l = { ...raw, productId: raw.productId ? toBase.get(raw.productId) ?? raw.productId : null };
      const k = l.productId ? `p${l.productId}` : `n${l.name}`;
      const x: Need = need.get(k) ?? { productId: l.productId, name: l.name, sku: l.sku, qty: 0, orders: [] };
      x.qty += l.qty;
      if (!x.orders.includes(o.id)) x.orders.push(o.id);
      need.set(k, x);
    }
  const ids = [...need.values()].map((x) => x.productId).filter((x): x is number => x !== null);
  const [cells, products] = await Promise.all([
    db.productCell.findMany({ where: { productId: { in: ids }, qty: { gt: 0 } }, include: { cell: true } }),
    db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, sku: true, barcode: true } }),
  ]);
  const prod = new Map<number, { id: number; name: string; sku: string | null; barcode: string | null }>(products.map((p) => [p.id, p]));
  const rows = [...need.values()].map((x) => {
    const pc = cells.filter((c) => c.productId === x.productId).sort((a, b) => a.cell.code.localeCompare(b.cell.code, "uk", { numeric: true }));
    return { ...x, product: x.productId ? prod.get(x.productId) : undefined, cells: pc };
  });
  // маршрут: спершу товари з коміркою (за кодом комірки), у кінці — без комірки
  rows.sort((a, b) => {
    const ca = a.cells[0]?.cell.code ?? "￿";
    const cb = b.cells[0]?.cell.code ?? "￿";
    return ca.localeCompare(cb, "uk", { numeric: true }) || a.name.localeCompare(b.name, "uk");
  });

  return (
    <>
      <div className="toolbar no-print">
        <h1 style={{ margin: 0 }}>Збирання замовлень</h1>
        <span className="spacer" />
        <span className="muted small">Заявки оновлено: {lastSync ? dateTimeUa(new Date(lastSync)) : "ще ні"}</span>
        <form action={refreshPicking}>
          <button className="btn" disabled={!enabled}>
            ⟳ Оновити з SalesDrive
          </button>
        </form>
        <Link className="btn primary" href="/picking/pack">
          📦 Пакування (скан ТТН)
        </Link>
        <PrintButton />
      </div>
      {sp.msg && <div className={`msg no-print ${sp.msg.startsWith("Помилка") ? "err" : "ok"}`}>{sp.msg}</div>}
      {!enabled && (
        <div className="msg warn">
          Потрібен ключ SalesDrive для читання заявок (SALESDRIVE_ORDERS_KEY), як для звіту по продажах. Дані клієнтів додаток не зберігає.
        </div>
      )}
      {enabled && !pick.length && <div className="msg warn">Оберіть унизу, які статуси заявок потрібно збирати (напр. «На відправку»).</div>}
      {pickSt.auto && pick.length > 0 && <p className="muted small no-print">Статус для збирання визначено автоматично: «На відправку». Змінити можна внизу.</p>}
      <p className="small no-print">
        Запаковано й чекає на пошту: <b>{packedCount}</b>{" "}
        <Link href={showPacked ? "/picking" : "/picking?packed=1"}>{showPacked ? "сховати запаковані" : "показати запаковані"}</Link>
      </p>

      {orders.length > 0 && (
        <form className="panel no-print">
          <div className="small" style={{ marginBottom: 6 }}>
            Заявки до збирання ({orders.length}):
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
            {orders.map((o) => (
              <span key={o.id} className="check small" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                <label className="check small">
                  <input type="checkbox" name="o" value={o.id} defaultChecked={selected.includes(o.id)} />№{o.id} · {statusName.get(o.statusId) ?? o.statusId} ·{" "}
                  {o.lines.reduce((s, l) => s + l.qty, 0)} шт{o.ttns.length ? ` · ТТН ${o.ttns[0]}` : " · без ТТН"}
                </label>
                {o.pack && (
                  <>
                    <span className="badge ok" title={`${o.pack.packedBy ?? ""} ${dateTimeUa(o.pack.packedAt)}`}>
                      запаковано{o.pack.checked ? "" : " без перевірки"}
                    </span>
                    <button className="btn sm" formAction={unpack} name="orderId" value={o.id} title="Скасувати позначку">
                      ↺
                    </button>
                  </>
                )}
              </span>
            ))}
          </div>
          {showPacked && <input type="hidden" name="packed" value="1" />}
          <button className="btn sm" style={{ marginTop: 8 }} title="Сформувати лист лише для позначених заявок">
            Сформувати для позначених
          </button>
        </form>
      )}

      <p className="small">
        Заявок: <b>{chosen.length}</b> · Позицій: <b>{rows.length}</b> · Штук: <b>{rows.reduce((s, r) => s + r.qty, 0)}</b>
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}>✓</th>
              <th>Комірка</th>
              <th>Товар</th>
              <th className="num">Взяти</th>
              <th>Заявки</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const inCells = r.cells.reduce((s, c) => s + c.qty, 0);
              return (
                <tr key={i}>
                  <td>☐</td>
                  <td>
                    {r.cells.length ? (
                      r.cells.map((c) => (
                        <div key={c.cellId}>
                          <b>{c.cell.code}</b> <span className="muted small">({c.qty})</span>
                        </div>
                      ))
                    ) : (
                      <span className="badge warn">без комірки</span>
                    )}
                  </td>
                  <td>
                    {r.productId ? <Link href={`/products/${r.productId}`}>{r.product?.name ?? r.name}</Link> : `${r.name} ⚠`}
                    <div className="muted small">{[r.product?.sku ?? r.sku, r.product?.barcode].filter(Boolean).join(" · ")}</div>
                    {r.cells.length > 0 && inCells < r.qty && <div className="small" style={{ color: "var(--warn)" }}>⚠ у комірках лише {inCells}</div>}
                  </td>
                  <td className="num" style={{ fontSize: 18 }}>
                    <b>{r.qty}</b>
                  </td>
                  <td className="small">{r.orders.map((o) => `№${o}`).join(", ")}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Немає товарів для збирання
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {user.role === "admin" && statuses.length > 0 && (
        <form action={savePickStatuses} className="panel no-print" style={{ marginTop: 16 }}>
          <b>Які статуси заявок збирати</b>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginTop: 8 }}>
            {statuses.map((s) => (
              <label key={s.id} className="check">
                <input type="checkbox" name="status" value={s.id} defaultChecked={pick.includes(s.id)} /> {s.name}
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
