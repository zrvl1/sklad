import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { dupGroups } from "@/lib/dupnames";
import { mainImage } from "@/lib/images";
import { money } from "@/lib/util";
import { saveDupNames } from "./actions";

export const dynamic = "force-dynamic";

// Однакові назви: на сайті такі товари дублюються (адреси з /ID/), і Google індексує лише один із групи
export default async function DupesPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await requirePerm("products.edit");
  const sp = await searchParams;
  const groups = await dupGroups();
  return (
    <>
      <h1>Однакові назви</h1>
      {sp.msg && <div className="msg ok">{sp.msg}</div>}
      <p className="muted small">
        Товари з однаковою назвою отримують на сайті адреси-дублі, і Google показує лише один із них. Додаток пропонує назву з брендом деталі
        за шаблоном «[Що] [бренд] [мотоцикли]». Перевірте й за потреби виправте назви, потім «Зберегти» — зміни підуть у SalesDrive, а звідти
        на сайт і Prom. Якщо товар зайвий (немає залишку, не продається, дубль) — краще видалити його в SalesDrive.
      </p>
      {groups.length === 0 && <p>Однакових назв немає 🎉</p>}
      <form action={saveDupNames}>
        {groups.map((g, gi) => (
          <div key={gi} className="panel">
            <div className="small muted" style={{ marginBottom: 6 }}>
              Група {gi + 1}: «{g[0].nameTranslate || g[0].name}»
            </div>
            <table className="small">
              <thead>
                <tr>
                  <th style={{ width: 48 }} />
                  <th>Артикул · бренд</th>
                  <th className="num">Ціна / собів.</th>
                  <th className="num">Залишок</th>
                  <th>Нова назва UA / RU</th>
                </tr>
              </thead>
              <tbody>
                {g.map((p) => {
                  const img = mainImage(p.images);
                  return (
                    <tr key={p.id}>
                      <td>{img ? <img src={img} alt="" loading="lazy" style={{ width: 40, height: 40, objectFit: "contain", background: "#fff" }} /> : null}</td>
                      <td>
                        <Link href={`/products/${p.id}`}>{p.sku}</Link>
                        {p.baseProductId ? <span className="muted"> · картка</span> : null}
                        <div className="muted">{p.manufacturer || "без бренду"}</div>
                      </td>
                      <td className="num">
                        {money(p.price)} / {p.cost ? money(p.cost) : "—"}
                      </td>
                      <td className="num">{p.stock}</td>
                      <td style={{ minWidth: 420 }}>
                        <input name={`ua_${p.id}`} defaultValue={p.sugUa} style={{ width: "100%" }} />
                        <input name={`ru_${p.id}`} defaultValue={p.sugRu} style={{ width: "100%", marginTop: 4 }} />
                        {p.note && <div style={{ color: "#c62828" }}>{p.note}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        {groups.length > 0 && <button className="btn primary">Зберегти назви й відправити в SalesDrive</button>}
      </form>
    </>
  );
}
