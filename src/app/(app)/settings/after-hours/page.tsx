import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { getSetting } from "@/lib/util";
import { cachedStatuses, fetchStatuses } from "@/lib/orders";
import { afterHoursCfg, writeKeyConfigured, type AfterHoursLog } from "@/lib/afterHours";
import { saveAfterHours, testAfterHours } from "./actions";

export default async function AfterHoursPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await requirePerm("settings");
  const sp = await searchParams;
  let statuses = await cachedStatuses();
  if (!statuses.length) {
    try {
      statuses = await fetchStatuses();
    } catch {}
  }
  const cfg = await afterHoursCfg();
  const guessFrom = cfg.fromStatusId ?? statuses.find((s) => /^нов/i.test(s.name) && !/смс|sms/i.test(s.name))?.id ?? "";
  const guessTo = cfg.toStatusId ?? statuses.find((s) => /нов.*(смс|sms)/i.test(s.name))?.id ?? "";
  let log: AfterHoursLog[] = [];
  try {
    log = JSON.parse((await getSetting("afterHoursLog")) ?? "[]");
  } catch {}
  return (
    <>
      <p>
        <Link href="/settings">← Налаштування</Link>
      </p>
      <h1>Заявки в неробочий час</h1>
      {sp.msg && <div className="msg">{sp.msg}</div>}
      <p className="muted small">
        Кожні 2 хвилини в неробочий час додаток переводить нові заявки зі статусу «з» у статус «на» (наприклад «Новий» → «Новий СМС»). У SalesDrive на
        статус «на» налаштуйте автовідправку SMS — клієнт одразу отримає повідомлення, що замовлення прийнято й буде відправлене. Змінюються лише
        заявки, створені в неробочий час; денні «Нові» менеджер опрацьовує сам.
      </p>
      {!writeKeyConfigured() && (
        <div className="msg err">
          Потрібен окремий API-ключ SalesDrive з правом <b>змінювати заявки</b>: SalesDrive → Налаштування → API → API-ключі → створити ключ (права:
          «Заявки — редагування»). Вставте його у Vercel → Environment Variables як <code>SALESDRIVE_ORDERS_WRITE_KEY</code> і зробіть Redeploy. Мені
          ключ не надсилайте.
        </div>
      )}
      <form action={saveAfterHours} className="panel">
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" name="enabled" defaultChecked={cfg.enabled} /> <b>Увімкнено</b>
        </label>
        <div className="grid2" style={{ marginTop: 8 }}>
          <label>
            Статус «з»
            <select name="from" defaultValue={String(guessFrom)}>
              <option value="">—</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Статус «на» (з автоSMS)
            <select name="to" defaultValue={String(guessTo)}>
              <option value="">—</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Пн–Пт неробочий час після
            <input name="weekdayEnd" defaultValue={cfg.weekdayEnd} placeholder="17:30" />
          </label>
          <label>
            Сб–Нд неробочий час після
            <input name="weekendEnd" defaultValue={cfg.weekendEnd} placeholder="16:00" />
          </label>
          <label>
            Робочий день починається о
            <input name="start" defaultValue={cfg.start} placeholder="10:00" />
          </label>
        </div>
        <button className="btn primary" style={{ marginTop: 8 }}>
          Зберегти
        </button>
      </form>
      <form action={testAfterHours} className="toolbar">
        <button className="btn">Перевірити зараз (нічого не змінює)</button>
      </form>
      {log.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Останні зміни</h2>
          <table className="small">
            <tbody>
              {log.map((l, i) => (
                <tr key={i}>
                  <td>{new Date(l.at).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}</td>
                  <td>№{l.id}</td>
                  <td style={{ color: l.ok ? "var(--ok)" : "var(--err)" }}>{l.info}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
