import Link from "next/link";
import { can, requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { cachedStatuses, fetchOrderLive, fetchOrdersByStatusLive, fetchStatuses, normTtn } from "@/lib/orders";
import { fill, listStatusIds, loadShop, loadTemplates, parseOrder, suggestTemplate } from "@/lib/messages";
import { saveListStatuses } from "./settings/actions";
import MessageCards from "./MessageCards";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ order?: string; debug?: string }> }) {
  const user = await requirePerm("picking");
  const sp = await searchParams;
  const q = (sp.order ?? "").trim();
  let orderId: number | null = null;
  let error: string | null = null;
  if (q) {
    if (/^\d{1,9}$/.test(q)) orderId = Number(q);
    else {
      const t = await db.orderTtn.findUnique({ where: { ttn: normTtn(q) } });
      if (t) orderId = t.orderId;
      else error = `Не знайшов заявку за «${q}». Вкажіть номер заявки SalesDrive або ТТН.`;
    }
  }
  let cards: { key: string; title: string; text: string }[] = [];
  let info: ReturnType<typeof parseOrder> | null = null;
  let keys: string[] = [];
  if (orderId) {
    try {
      const raw = await fetchOrderLive(orderId);
      if (!raw) error = `Заявку №${orderId} не знайдено в SalesDrive`;
      else {
        keys = Object.keys(raw);
        info = parseOrder(raw);
        const [tpls, shop] = await Promise.all([loadTemplates(), loadShop()]);
        cards = tpls.map((t) => ({ key: t.key, title: t.title, text: fill(t.text, info!, shop) }));
      }
    } catch (e) {
      error = `SalesDrive: ${e instanceof Error ? e.message : e}`;
    }
  }

  // список заявок у вибраних статусах — наживо з SalesDrive (лише коли не відкрита конкретна заявка)
  let statuses = await cachedStatuses();
  if (!statuses.length) {
    try {
      statuses = await fetchStatuses();
    } catch {}
  }
  const listIds = await listStatusIds(statuses);
  let list: ReturnType<typeof parseOrder>[] = [];
  let listError: string | null = null;
  if (!q && listIds.length) {
    try {
      list = (await fetchOrdersByStatusLive(listIds)).map(parseOrder).sort((a, b) => b.time.localeCompare(a.time));
    } catch (e) {
      listError = `SalesDrive: ${e instanceof Error ? e.message : e}`;
    }
  }
  const stName = (id: number) => statuses.find((s) => s.id === id)?.name ?? `статус ${id}`;
  const suggested = info ? suggestTemplate(info) : null;

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Повідомлення клієнту</h1>
        <span className="spacer" />
        {can(user, "settings") && (
          <Link className="btn sm" href="/messages/settings">
            ✎ Шаблони й контакти
          </Link>
        )}
      </div>
      <p className="muted small">
        Введіть номер заявки або відскануйте ТТН — шаблони заповняться даними заявки. «Копіювати й відкрити Viber/Telegram» скопіює текст і відкриє чат
        клієнта: залишиться вставити (Ctrl+V) і надіслати. Дані клієнта беруться з SalesDrive і в додатку не зберігаються.
      </p>
      <form className="panel toolbar">
        <input name="order" defaultValue={q} placeholder="№ заявки або ТТН" autoFocus style={{ minWidth: 240 }} />
        <button className="btn primary">Заповнити</button>
      </form>
      {error && <div className="msg err">{error}</div>}
      {q && (
        <p>
          <Link href="/messages">← До списку заявок</Link>
        </p>
      )}
      {!q && (
        <div className="panel">
          <div className="toolbar" style={{ marginTop: 0, flexWrap: "wrap" }}>
            <b>Заявки: {listIds.map(stName).join(", ") || "статус не вибрано"}</b>
            <span className="small muted">({list.length}) — оновлюються з SalesDrive при кожному відкритті сторінки</span>
            <span className="spacer" />
            {can(user, "settings") && statuses.length > 0 && (
              <form action={saveListStatuses} className="toolbar" style={{ margin: 0 }}>
                <select name="st" multiple defaultValue={listIds.map(String)} size={4} style={{ minWidth: 200 }} title="Ctrl+клік — кілька статусів (до 3)">
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button className="btn sm">Показувати ці статуси</button>
              </form>
            )}
          </div>
          {listError && <div className="msg err">{listError}</div>}
          {list.length === 0 && !listError ? (
            <p className="muted">Заявок у цьому статусі немає.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Дата</th>
                  <th>Клієнт</th>
                  <th className="num">Сума</th>
                  <th>Оплата</th>
                  <th>Доставка</th>
                  <th>Звідки</th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/messages?order=${o.id}`}>
                        <b>{o.id}</b>
                      </Link>
                    </td>
                    <td className="small">{o.time.slice(0, 16)}</td>
                    <td>
                      <Link href={`/messages?order=${o.id}`}>{o.name || "—"}</Link>
                      <div className="small muted">{o.phone}</div>
                    </td>
                    <td className="num">{o.total.toLocaleString("uk-UA")}</td>
                    <td className="small">
                      {o.payment || "—"}
                      {o.cod > 0 && <div className="badge warn">накладений</div>}
                    </td>
                    <td className="small">{o.delivery}</td>
                    <td className="small">{o.site || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {info && (
        <>
          <div className="panel">
            <b>
              Заявка №{info.id} · {info.name || "без імені"}
            </b>{" "}
            · {info.phone || "немає телефону"} · {info.delivery}
            {info.ttn ? ` · ТТН ${info.ttn}` : ""}
            {sp.debug && <div className="small muted">Поля заявки: {keys.join(", ")}</div>}
          </div>
          <MessageCards cards={cards} phone={info.phone} suggested={suggested} />
        </>
      )}
    </>
  );
}
