import { db } from "@/lib/db";
import { ROLE_LABELS, can, requireUser } from "@/lib/auth";
import { isSalesDriveConfigured } from "@/lib/salesdrive";
import { dateTimeUa, getSetting } from "@/lib/util";
import { addCell, addUser, changeOwnPassword, deleteCell, generateCells, manageUser, saveSupplier, saveWarehouse, syncNow } from "./actions";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const [warehouses, suppliers, users, lastSyncRaw, logs, attempts] = await Promise.all([
    db.warehouse.findMany({ orderBy: { name: "asc" }, include: { cells: { orderBy: { code: "asc" } } } }),
    db.supplier.findMany({ orderBy: { name: "asc" } }),
    isAdmin ? db.user.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
    getSetting("lastSync"),
    db.actionLog.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { user: true } }),
    isAdmin ? db.loginAttempt.findMany({ orderBy: { createdAt: "desc" }, take: 20 }) : Promise.resolve([]),
  ]);
  const lastSync = lastSyncRaw ? (JSON.parse(lastSyncRaw) as { at: string; total: number; created: number; updated: number }) : null;
  const ymlOn = Boolean(process.env.SALESDRIVE_YML_URL);

  return (
    <>
      <h1>Налаштування</h1>
      {msg && <div className={`msg ${msg.startsWith("Помилка") ? "err" : "ok"}`}>{msg}</div>}

      {can(user, "sync") && (
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>SalesDrive</h2>
        <p className="small">
          Запис товарів (API): {isSalesDriveConfigured() ? <span className="badge ok">налаштовано</span> : <span className="badge err">немає ключа в .env</span>}
          {" · "}
          Читання (YML): {ymlOn ? <span className="badge ok">налаштовано</span> : <span className="badge err">немає посилання в .env</span>}
        </p>
        <p className="small muted">
          Остання синхронізація:{" "}
          {lastSync ? `${dateTimeUa(new Date(lastSync.at))} — усього ${lastSync.total}, нових ${lastSync.created}, оновлено ${lastSync.updated}` : "ще не було"}
        </p>
        <form action={syncNow}>
          <button className="btn primary" disabled={!ymlOn}>
            ⟳ Завантажити товари з SalesDrive
          </button>
        </form>
      </div>
      )}

      {isAdmin && (
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Склади</h2>
        <p className="small muted">
          «ID у SalesDrive» — ідентифікатор складу з розділу Установки → Загальні налаштування і інтеграції → Інші сервіси → API. Якщо склад один, можна
          залишити порожнім. Склад «за замовчуванням» отримує залишки з YML.
        </p>
        {warehouses.map((w) => (
          <form key={w.id} action={saveWarehouse} className="row" style={{ marginBottom: 8 }}>
            <input type="hidden" name="id" value={w.id} />
            <input name="name" defaultValue={w.name} disabled={!isAdmin} />
            <input name="sdStockId" defaultValue={w.sdStockId ?? ""} placeholder="ID у SalesDrive" style={{ width: 150 }} disabled={!isAdmin} />
            <label className="check">
              <input type="checkbox" name="isDefault" defaultChecked={w.isDefault} disabled={!isAdmin} /> за замовчуванням
            </label>
            {isAdmin && <button className="btn sm">Зберегти</button>}
            <a className="btn sm" href={`/print/cells?warehouse=${w.id}`} target="_blank">
              🖨 Етикетки комірок ({w.cells.length})
            </a>
          </form>
        ))}
        {isAdmin && (
          <form action={saveWarehouse} className="row">
            <input name="name" placeholder="Новий склад / точка" />
            <input name="sdStockId" placeholder="ID у SalesDrive" style={{ width: 150 }} />
            <button className="btn sm">Додати склад</button>
          </form>
        )}
      </div>
      )}

      {can(user, "cells.edit") && (
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Комірки</h2>
        <form action={generateCells} className="row" style={{ marginBottom: 12 }}>
          <label>
            Склад
            <select name="warehouseId">
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ряд / зона
            <input name="prefix" defaultValue="A" style={{ width: 70 }} />
          </label>
          <label>
            Стелажів
            <input name="racks" type="number" defaultValue={5} style={{ width: 80 }} />
          </label>
          <label>
            Полиць у стелажі
            <input name="shelves" type="number" defaultValue={4} style={{ width: 80 }} />
          </label>
          <button className="btn">Створити сіткою (A-01-1 …)</button>
        </form>
        <form action={addCell} className="row" style={{ marginBottom: 12 }}>
          <select name="warehouseId">
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <input name="code" placeholder="Код, напр. ВІТРИНА-1" />
          <input name="note" placeholder="Примітка" />
          <button className="btn sm">Додати одну</button>
        </form>
        {warehouses.map((w) => (
          <div key={w.id} style={{ marginBottom: 10 }}>
            <b>{w.name}:</b>{" "}
            {w.cells.length === 0 && <span className="muted">немає</span>}
            {w.cells.map((c) => (
              <form key={c.id} action={deleteCell} style={{ display: "inline-block", margin: "3px 4px 3px 0" }}>
                <input type="hidden" name="id" value={c.id} />
                <span className="badge">
                  {c.code}
                  {isAdmin && (
                    <button style={{ border: 0, background: "none", cursor: "pointer", color: "#b91c1c", padding: "0 0 0 4px" }} title="Видалити">
                      ×
                    </button>
                  )}
                </span>
              </form>
            ))}
          </div>
        ))}
      </div>
      )}

      {can(user, "receipts") && (
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Постачальники</h2>
        <div style={{ marginBottom: 10 }}>
          {suppliers.map((s) => (
            <span key={s.id} className="badge" style={{ margin: "0 6px 6px 0" }}>
              {s.name}
              {s.phone ? ` · ${s.phone}` : ""}
            </span>
          ))}
        </div>
        <form action={saveSupplier} className="row">
          <input name="name" placeholder="Назва постачальника" />
          <input name="phone" placeholder="Телефон" />
          <button className="btn sm">Додати</button>
        </form>
      </div>
      )}

      {isAdmin && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Користувачі</h2>
          {users.map((u) => (
            <div key={u.id} className="row small" style={{ marginBottom: 6 }}>
              <span style={{ minWidth: 220 }}>
                {u.name} — {u.login} <span className="badge">{ROLE_LABELS[u.role] ?? u.role}</span>{" "}
                {!u.active && <span className="badge err">заблоковано</span>}
              </span>
              <form action={manageUser}>
                <input type="hidden" name="id" value={u.id} />
                <input type="hidden" name="action" value={u.active ? "disable" : "enable"} />
                <button className="btn sm">{u.active ? "Заблокувати" : "Розблокувати"}</button>
              </form>
              <form action={manageUser} className="row" style={{ gap: 6 }}>
                <input type="hidden" name="id" value={u.id} />
                <input type="hidden" name="action" value="password" />
                <input name="password" type="password" placeholder="новий пароль" autoComplete="new-password" style={{ width: 150 }} />
                <button className="btn sm">Задати пароль</button>
              </form>
            </div>
          ))}
          <form action={addUser} className="row" style={{ marginTop: 10 }}>
            <input name="name" placeholder="Ім'я" />
            <input name="login" placeholder="Логін" />
            <input name="password" type="password" placeholder="Пароль" />
            <select name="role" defaultValue="manager">
              <option value="manager">менеджер (заявки й пакування)</option>
              <option value="storekeeper">комірник (склад)</option>
              <option value="admin">адміністратор (усе)</option>
            </select>
            <button className="btn sm">Додати</button>
          </form>
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Мій пароль</h2>
        <form action={changeOwnPassword} className="row">
          <input name="current" type="password" placeholder="Поточний пароль" autoComplete="current-password" required />
          <input name="next" type="password" placeholder="Новий (10+ символів)" autoComplete="new-password" required />
          <input name="repeat" type="password" placeholder="Повторіть новий" autoComplete="new-password" required />
          <button className="btn sm">Змінити пароль</button>
        </form>
      </div>

      {isAdmin && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Спроби входу (останні 20)</h2>
          <div className="tablewrap">
            <table className="small">
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td>{dateTimeUa(a.createdAt)}</td>
                    <td>{a.login}</td>
                    <td>{a.ip}</td>
                    <td>{a.ok ? <span className="badge ok">успішно</span> : <span className="badge err">невдало</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isAdmin && (
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Журнал дій (останні 30)</h2>
        <div className="tablewrap">
          <table className="small">
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{dateTimeUa(l.createdAt)}</td>
                  <td>{l.user?.name ?? "—"}</td>
                  <td>
                    {l.action} · {l.entity} {l.entityId ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </>
  );
}
