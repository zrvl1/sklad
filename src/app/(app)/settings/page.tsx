import { db } from "@/lib/db";
import { PROM_UA_KW_ENABLED } from "@/lib/prom";
import { ROLE_LABELS, can, requireUser } from "@/lib/auth";
import { isSalesDriveConfigured } from "@/lib/salesdrive";
import { dateTimeUa, getSetting } from "@/lib/util";
import { addCell, addUser, changeOwnPassword, deleteCell, generateCells, manageUser, promFeedKeyAction, promFindDups, promHideDups, promKw, promRunNow, promTest, promToggle, saveCostMethod, saveSupplier, saveWarehouse, syncNow } from "./actions";
import { promConfigured } from "@/lib/prom";

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
  const costMethod = (await getSetting("costMethod")) ?? "avg";
  const [promOnRaw, promLastRaw, promDryRaw, promLogRaw] = isAdmin
    ? await Promise.all([getSetting("promEnabled"), getSetting("promLast"), getSetting("promDry"), getSetting("promLog")])
    : [null, null, null, null];
  const promOn = promOnRaw === "1";
  const promKwAuto = isAdmin ? (await getSetting("promKwAuto")) === "1" : false;
  const promFeedKey = isAdmin ? await getSetting("promFeedKey") : null;
  const promFeedUrl = promFeedKey ? `${process.env.APP_URL || "https://sklad-tau.vercel.app"}/api/feed/prom?key=${promFeedKey}` : null;
  const promNoKw = isAdmin
    ? await (async () => {
        const { uaKeywordsMissing } = await import("@/lib/prom");
        const prods = await db.product.findMany({ where: { deletedAt: null, sdId: { not: null } }, select: { sdId: true, keywords: true } });
        const ru = new Map<string, string | null>(prods.map((p) => [p.sdId as string, p.keywords as string | null]));
        const links = await db.promLink.findMany({ select: { externalId: true, keywordsUa: true } });
        return links.filter((l) => l.externalId && ru.get(l.externalId)?.trim() && uaKeywordsMissing(l.keywordsUa, ru.get(l.externalId))).length;
      })()
    : 0;
  const promDupsRaw = isAdmin ? await getSetting("promDups") : null;
  const promDups = promDupsRaw ? (JSON.parse(promDupsRaw) as string[]) : null;
  type PromRes = { at: string; prom: number; matched: number; unmatched: number; changes: number; sent: number; errors: string[]; guard: boolean };
  const promLast = promLastRaw ? (JSON.parse(promLastRaw) as PromRes) : null;
  const promDry = promDryRaw
    ? (JSON.parse(promDryRaw) as PromRes & { sample: { name: string | null; from: string; to: string }[]; unmatchedSample: string[] })
    : null;
  const promLog = promLogRaw ? (JSON.parse(promLogRaw) as { at: string; name: string | null; from: string; to: string }[]) : [];
  const sdDebugRaw = isAdmin ? await getSetting("lastSdResponse") : null;
  const sdDebug = sdDebugRaw ? (JSON.parse(sdDebugRaw) as { at: string; status: number; sent: string; response: string }) : null;
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
          <h2 style={{ marginTop: 0 }}>Резервна копія</h2>
          <p className="small muted">
            Один файл з усім, що є лише в додатку: комірки, приходи, списання, інвентаризації, рух товару, гроші, шаблони, коди. Зберігайте раз на тиждень
            (і перед великими змінами) на Google Диск чи флешку. Файл містить собівартість — нікому не пересилайте.
          </p>
          <a className="btn" href="/api/backup">
            ⬇ Завантажити резервну копію
          </a>
        </div>
      )}

      {isAdmin && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Prom: швидке оновлення наявності</h2>
          <p className="small muted">
            Кожні 5 хвилин додаток бере залишки з SalesDrive і через API Prom змінює наявність і кількість лише тих товарів, де вона змінилась. Товари зі
            статусом «під замовлення» / «очікується» не чіпаються. Імпорт YML на Prom працює як раніше. Запобіжник: якщо раптом багато товарів стає «немає
            в наявності» — нічого не відправляється.
          </p>
          {!promConfigured() ? (
            <div className="msg warn small">
              Додайте у Vercel змінну <b>PROM_API_TOKEN</b> (токен Prom лише з доступом до товарів) і зробіть Redeploy.
            </div>
          ) : (
            <>
              <div className="toolbar">
                <span>
                  Стан: {promOn ? <span className="badge ok">увімкнено, кожні 5 хв</span> : <span className="badge">вимкнено</span>}
                </span>
                <form action={promTest}>
                  <button className="btn sm">1. Перевірити (без відправки)</button>
                </form>
                <form action={promRunNow}>
                  <button className="btn sm">2. Відправити зміни зараз</button>
                </form>
                <form action={promToggle}>
                  <input type="hidden" name="on" value={promOn ? "0" : "1"} />
                  <button className={`btn sm ${promOn ? "" : "primary"}`}>{promOn ? "Вимкнути автооновлення" : "3. Увімкнути автооновлення"}</button>
                </form>
              </div>
              {promLast && (
                <p className="small">
                  Остання відправка: {dateTimeUa(new Date(promLast.at))} · зіставлено {promLast.matched} з {promLast.prom} · змін {promLast.changes} ·
                  відправлено {promLast.sent}
                  {promLast.guard && <span className="badge err"> спрацював запобіжник</span>}
                  {promLast.errors.length > 0 && <span style={{ color: "var(--err)" }}> · помилки: {promLast.errors.slice(0, 3).join("; ")}</span>}
                </p>
              )}
              {promDry && (
                <details className="small">
                  <summary>
                    Перевірка {dateTimeUa(new Date(promDry.at))}: змінилося б {promDry.changes}, не зіставлено {promDry.unmatched}
                  </summary>
                  {promDry.sample.map((c, i) => (
                    <div key={i}>
                      {c.name}: {c.from} → <b>{c.to}</b>
                    </div>
                  ))}
                  {promDry.unmatchedSample.length > 0 && (
                    <p className="muted">
                      Не знайдено в SalesDrive (за ID імпорту чи артикулом): {promDry.unmatchedSample.join("; ")}
                      {promDry.unmatched > promDry.unmatchedSample.length ? "…" : ""}
                    </p>
                  )}
                </details>
              )}
              {PROM_UA_KW_ENABLED ? (
                <div className="toolbar" style={{ marginTop: 8 }}>
                <span className="small">
                  Українські пошукові запити на Prom (без них ≈ {promNoKw}; оновиться після «Перевірити»):
                </span>
                <form action={promKw}>
                  <input type="hidden" name="mode" value="test" />
                  <button className="btn sm">Тест на 1 товарі</button>
                </form>
                <form action={promKw}>
                  <input type="hidden" name="mode" value="all" />
                  <button className="btn sm">Заповнити всім, де немає</button>
                </form>
                <form action={promKw}>
                  <input type="hidden" name="mode" value={promKwAuto ? "auto-off" : "auto-on"} />
                  <button className={`btn sm ${promKwAuto ? "" : "primary"}`}>{promKwAuto ? "Вимкнути авто" : "Авто для нових товарів"}</button>
                </form>
              </div>
              ) : (
                <>
                <div style={{ marginTop: 8 }}>
                  <div className="small">
                    <b>Фід для Prom з українськими пошуковими запитами</b> — те саме, що YML SalesDrive, плюс українські запити з карток
                    (порожні перекладаються автоматично). Вставте це посилання в імпорт Prom <b>замість</b> посилання SalesDrive.
                    Посилання секретне — нікому не пересилайте.
                  </div>
                  {promFeedUrl && (
                    <input readOnly className="input" style={{ width: "100%", margin: "6px 0", fontFamily: "monospace", fontSize: 12 }} value={promFeedUrl} />
                  )}
                  <form action={promFeedKeyAction}>
                    <input type="hidden" name="mode" value={promFeedUrl ? "regen" : "new"} />
                    <button className={`btn sm ${promFeedUrl ? "" : "primary"}`}>{promFeedUrl ? "Створити нове посилання (старе перестане працювати)" : "Створити посилання"}</button>
                  </form>
                </div>
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <span className="small">Або файлом:</span>
                  <a className="btn sm" href="/api/prom/ua-keywords">
                    ⬇ Файл для імпорту на Prom (CSV)
                  </a>
                  <form method="get" action="/api/prom/ua-keywords" className="toolbar">
                    <input name="sku" className="input" placeholder="CM0001" style={{ width: 110 }} />
                    <button className="btn sm">⬇ лише ці артикули</button>
                  </form>
                  <span className="small muted">
                    Prom → Імпорт → «з компʼютера» → «Тільки оновлення», відмітити лише «Пошукові запити (українською)»
                  </span>
                </div>
                </>
              )}
              <div className="toolbar" style={{ marginTop: 8 }}>
                <span className="small">Дублі товарів на Prom:</span>
                <form action={promFindDups}>
                  <button className="btn sm">Знайти</button>
                </form>
                {promDups && promDups.length > 0 && (
                  <form action={promHideDups}>
                    <button className="btn sm danger">Приховати дублі з вітрини</button>
                  </form>
                )}
              </div>
              {promDups && promDups.length > 0 && (
                <details className="small">
                  <summary>Дублі (товари з тим самим артикулом, але без ID SalesDrive) — перші {promDups.length}</summary>
                  {promDups.map((d, i) => (
                    <div key={i}>{d}</div>
                  ))}
                </details>
              )}
              {promLog.length > 0 && (
                <details className="small">
                  <summary>Останні зміни на Prom ({promLog.length})</summary>
                  {promLog.map((c, i) => (
                    <div key={i}>
                      {dateTimeUa(new Date(c.at))} · {c.name}: {c.from} → {c.to}
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
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

      {can(user, "costs") && (
        <form action={saveCostMethod} className="panel">
          <h2 style={{ marginTop: 0 }}>Собівартість при приході</h2>
          <label className="check">
            <input type="radio" name="costMethod" value="avg" defaultChecked={costMethod !== "last"} /> <b>Середньозважена</b> (рекомендовано): залишок за
            старою ціною + новий прихід за новою. 2 шт по 100 + 3 шт по 150 → 130 грн
          </label>
          <label className="check">
            <input type="radio" name="costMethod" value="last" defaultChecked={costMethod === "last"} /> Ціна останньої закупівлі: усі штуки → 150 грн
          </label>
          <p className="small muted">
            Собівартість іде в SalesDrive, а він записує її в кожну заявку на момент продажу — з неї рахується маржа в CRM і в «Звіт: продажі».
          </p>
          <button className="btn sm">Зберегти</button>
        </form>
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

      {isAdmin && sdDebug && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Остання відповідь SalesDrive</h2>
          <p className="small muted">
            {dateTimeUa(new Date(sdDebug.at))} · статус {sdDebug.status}
          </p>
          <div className="small">
            <b>Відправлено:</b>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", background: "#f7f8fa", padding: 8, borderRadius: 6 }}>{sdDebug.sent}</pre>
            <b>Відповідь:</b>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", background: "#f7f8fa", padding: 8, borderRadius: 6 }}>{sdDebug.response || "(порожня)"}</pre>
          </div>
        </div>
      )}

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
