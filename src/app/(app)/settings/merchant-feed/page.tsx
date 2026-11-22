import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { getSetting } from "@/lib/util";
import { labelCfg, labelRows } from "@/lib/merchantLabels";
import { newFeedKey, saveLabelCfg } from "./actions";

export default async function MerchantFeedPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await requirePerm("settings");
  await requirePerm("costs");
  const sp = await searchParams;
  const [key, cfg, rows] = await Promise.all([getSetting("merchantFeedKey"), labelCfg(), labelRows()]);
  const url = key ? `${process.env.APP_URL || "https://sklad-tau.vercel.app"}/api/feed/merchant-labels?key=${key}` : null;
  const cnt = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const groups = ["маржа-висока", "маржа-середня", "маржа-низька", "маржа-невідома"];
  return (
    <>
      <p>
        <Link href="/settings">← Налаштування</Link>
      </p>
      <h1>Фід міток для Google Merchant</h1>
      {sp.msg && <div className="msg">{sp.msg}</div>}
      <p className="muted small">
        Додаткове джерело даних для Merchant Center: до кожного товару — бренд і мітки <b>custom_label_0</b> (маржа з продажу), <b>custom_label_1</b>{" "}
        (залишок), <b>custom_label_2</b> (ціна). Покупці їх не бачать — вони потрібні, щоб у Google Ads не рекламувати товари з малою маржею.
      </p>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Посилання на фід</h2>
        {url ? <input readOnly style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} value={url} /> : <p className="muted">Ще не створено.</p>}
        <form action={newFeedKey} style={{ marginTop: 8 }}>
          <button className={`btn sm${url ? "" : " primary"}`}>{url ? "Створити нове (старе перестане працювати)" : "Створити посилання"}</button>
        </form>
        <p className="small muted">
          Merchant Center → Товари → Джерела даних → «Додати додаткове джерело» → «Отримувати файл за посиланням» → вставити посилання, щодня. Посилання
          секретне.
        </p>
      </div>

      <form action={saveLabelCfg} className="panel toolbar" style={{ flexWrap: "wrap" }}>
        <b>Маржа з одного продажу:</b>
        <span className="small">низька — до</span>
        <input name="low" defaultValue={cfg.low} style={{ width: 70 }} />
        <span className="small">грн, висока — від</span>
        <input name="high" defaultValue={cfg.high} style={{ width: 70 }} />
        <span className="small">грн. ID товару в Merchant =</span>
        <select name="idField" defaultValue={cfg.idField}>
          <option value="sdId">ID SalesDrive (як «Артикул» у Horoshop)</option>
          <option value="sku">SKU (CM…)</option>
        </select>
        <button className="btn sm primary">Зберегти</button>
      </form>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Розподіл товарів</h2>
        <div className="toolbar" style={{ flexWrap: "wrap" }}>
          {groups.map((g) => (
            <span key={g} className="badge">
              {g}: {cnt((r) => r.margin === g)}
            </span>
          ))}
          <span className="badge">без бренду: {cnt((r) => !r.brand)}</span>
        </div>
        <p className="small muted">Перші 15 рядків — звірте ID з ID товару в Merchant Center (Товари → відкрити товар → «Ідентифікатор товару»):</p>
        <table className="small">
          <thead>
            <tr>
              <th>ID</th>
              <th>Товар</th>
              <th>Бренд</th>
              <th className="num">Маржа, грн</th>
              <th>Мітки</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 15).map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.name}</td>
                <td>{r.brand || "—"}</td>
                <td className="num">{r.marginUah ?? "—"}</td>
                <td>
                  {r.margin} · {r.stock} · {r.price}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
