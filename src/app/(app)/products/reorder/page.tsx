import Link from "next/link";
import { requirePerm, can } from "@/lib/auth";
import { reorderRows } from "@/lib/demand";
import { ua } from "@/lib/names";
import { mainImage } from "@/lib/images";
import { money } from "@/lib/util";
import { draftReceiptForSupplier, saveMins, saveReorderSettings } from "./actions";

export const dynamic = "force-dynamic";

type SP = Promise<{ f?: string; msg?: string }>;
const FILTERS: Record<string, string> = { below: "Нижче мінімуму", sold: "Усі, що продаються", all: "Усі товари" };

// Що дозамовити: мінімальні залишки + рекомендована кількість, згруповано за постачальником
export default async function ReorderPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePerm("products.edit");
  const sp = await searchParams;
  const f = sp.f && FILTERS[sp.f] ? sp.f : "below";
  const { rows, leadDays, coverDays } = await reorderRows();
  const list = rows
    .filter((r) => (f === "below" ? r.below : f === "sold" ? r.sold90 > 0 || r.minStock !== null : true))
    .sort((a, b) => Number(b.below) - Number(a.below) || b.sold90 - a.sold90);
  const groups = new Map<string, typeof list>();
  for (const r of list) {
    const k = r.supplierName ?? "";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const groupList = [...groups.entries()].sort((a, b) => b[1].filter((x) => x.below).length - a[1].filter((x) => x.below).length);
  const counts = { below: rows.filter((r) => r.below).length, sold: rows.filter((r) => r.sold90 > 0 || r.minStock !== null).length, all: rows.length };
  const orderSum = rows.filter((r) => r.below).reduce((s, r) => s + r.toOrder * r.cost, 0);

  return (
    <>
      <h1>Що дозамовити</h1>
      {sp.msg && <div className="msg ok">{sp.msg}</div>}
      <p className="muted small">
        Мінімальний залишок задається в товарі; порожнє поле — додаток підказує сам: продажі за час поставки ({leadDays} дн.) за
        темпом останніх 30/90 днів. «Дозамовити» — щоб вистачило на поставку + {coverDays} дн. Продажі карток-комплектів зараховано основному
        товару.
      </p>
      <form action={saveReorderSettings} className="toolbar small">
        Поставка триває
        <input name="lead" type="number" min={1} defaultValue={leadDays} style={{ width: 64 }} /> дн. · закуповуємо на
        <input name="cover" type="number" min={0} defaultValue={coverDays} style={{ width: 64 }} /> дн.
        <button className="btn sm">Зберегти</button>
      </form>
      <div className="stats">
        <div className="stat">
          Нижче мінімуму
          <b>{counts.below}</b>
        </div>
        <div className="stat">
          Орієнтовна сума закупівлі
          <b>{money(orderSum)}</b>
          <span className="muted small">за поточною собівартістю</span>
        </div>
      </div>
      <div className="toolbar">
        {Object.entries(FILTERS).map(([k, t]) => (
          <Link key={k} className={`btn sm ${f === k ? "primary" : ""}`} href={`/products/reorder?f=${k}`}>
            {t} ({counts[k as keyof typeof counts]})
          </Link>
        ))}
      </div>
      <form action={saveMins}>
        <input type="hidden" name="f" value={f} />
        {groupList.length === 0 && <p className="muted">Усе в нормі — нічого дозамовляти 🎉</p>}
        {groupList.map(([supplier, items]) => {
          const toBuy = items.filter((x) => x.below && x.toOrder > 0);
          return (
            <div key={supplier} className="panel">
              <div className="toolbar" style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>{supplier || "Без постачальника"}</h2>
                {can(user, "receipts") && toBuy.length > 0 && (
                  <button className="btn sm" formAction={draftReceiptForSupplier} name="supplier" value={supplier}>
                    Створити чернетку приходу ({toBuy.length} поз., {money(toBuy.reduce((s, x) => s + x.toOrder * x.cost, 0))})
                  </button>
                )}
              </div>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>Фото</th>
                    <th>Товар</th>
                    <th className="num">Залишок</th>
                    <th className="num">Продано 30 / 90 дн</th>
                    <th className="num">Мін. залишок</th>
                    <th className="num">Дозамовити</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => {
                    const img = mainImage(r.images);
                    return (
                      <tr key={r.id} style={r.below ? { background: "#fbebeb" } : undefined}>
                        <td>
                          {img ? (
                            <img src={img} alt="" loading="lazy" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6 }} />
                          ) : null}
                        </td>
                        <td>
                          <Link href={`/products/${r.id}`}>{ua(r)}</Link>
                          <div className="muted small">{r.sku}</div>
                        </td>
                        <td className="num">{r.stock}</td>
                        <td className="num">
                          {r.sold30} / {r.sold90}
                        </td>
                        <td className="num">
                          <input type="hidden" name={`prev_${r.id}`} value={r.minStock ?? ""} />
                          <input
                            name={`min_${r.id}`}
                            defaultValue={r.minStock ?? ""}
                            placeholder={r.suggestedMin ? `${r.suggestedMin} (підк.)` : "0"}
                            inputMode="decimal"
                            style={{ width: 90, textAlign: "right" }}
                          />
                        </td>
                        <td className="num">{r.toOrder ? <b>{r.toOrder}</b> : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
        {groupList.length > 0 && <button className="btn primary">Зберегти мінімальні залишки</button>}
      </form>
    </>
  );
}
