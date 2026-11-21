import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { SHOP_FIELDS, loadShop, loadTemplates } from "@/lib/messages";
import { saveMsgSettings } from "./actions";

export default async function MsgSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requirePerm("settings");
  const sp = await searchParams;
  const [tpls, shop] = await Promise.all([loadTemplates(), loadShop()]);
  return (
    <>
      <p>
        <Link href="/messages">← Повідомлення клієнту</Link>
      </p>
      <h1>Шаблони повідомлень</h1>
      {sp.saved && <div className="msg ok">Збережено</div>}
      <p className="muted small">
        Змінні заявки: {"{номер} {ім'я} {піб} {телефон} {товари} {сума} {оплата} {доставка} {ттн} {до_сплати} {відгук}"} (відгук — Prom для заявок з
        Prom, інакше Google). Контакти магазину: {SHOP_FIELDS.map((f) => `{${f.key}}`).join(" ")}. Щоб повернути стандартний текст — очистіть поле.
      </p>
      <form action={saveMsgSettings}>
        <div className="panel grid2">
          {SHOP_FIELDS.map((f) => (
            <label key={f.key}>
              {f.label} <span className="muted small">{`{${f.key}}`}</span>
              <input name={`s_${f.key}`} defaultValue={shop[f.key] ?? ""} placeholder={f.ph} />
            </label>
          ))}
        </div>
        {tpls.map((t) => (
          <div key={t.key} className="panel">
            <b>{t.title}</b>
            <textarea name={`t_${t.key}`} defaultValue={t.text} rows={Math.min(20, t.text.split("\n").length + 2)} style={{ width: "100%", marginTop: 6, fontFamily: "inherit" }} />
          </div>
        ))}
        <button className="btn primary">Зберегти</button>
      </form>
    </>
  );
}
