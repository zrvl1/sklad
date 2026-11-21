import Link from "next/link";
import { can, requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchOrderLive, normTtn } from "@/lib/orders";
import { fill, loadShop, loadTemplates, parseOrder } from "@/lib/messages";
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
          <MessageCards cards={cards} phone={info.phone} />
        </>
      )}
    </>
  );
}
