import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getSetting } from "@/lib/util";
import { allCategories } from "@/lib/categories";
import { saveFeedCategories } from "../../actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function FeedCategoriesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  await requirePerm("products.edit");
  const id = Number((await params).id);
  const sp = await searchParams;
  const s = await db.supplier.findUnique({ where: { id } });
  if (!s) notFound();
  const [groups, cats, mapRaw] = await Promise.all([
    db.supplierItem.groupBy({ by: ["category"], where: { supplierId: id }, _count: true }),
    allCategories(),
    getSetting("feedCategoryMap"),
  ]);
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(mapRaw ?? "{}");
  } catch {}
  const rows = groups
    .filter((g) => g.category)
    .map((g) => ({ name: g.category as string, count: g._count }))
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));
  const def = (name: string) => {
    const m = map[`${id}:${name}`];
    if (m) return m;
    const same = cats.filter((c) => c.name.toLowerCase() === name.toLowerCase());
    return same.length === 1 ? same[0].path : "";
  };
  const mapped = rows.filter((r) => def(r.name)).length;
  return (
    <>
      <p>
        <Link href={`/suppliers/${id}`}>← {s.name}</Link>
      </p>
      <h1>Категорії фіду → категорії сайту</h1>
      {sp.msg && <div className="msg">{sp.msg}</div>}
      {sp.err && <div className="msg err">{sp.err}</div>}
      <p className="muted small">
        У фіді {rows.length} категорій, зіставлено {mapped}. Зіставлена категорія підставляється автоматично при створенні товару з XML. Категорія
        фіду з такою самою назвою, як ваша, зіставляється сама.
      </p>
      <form action={saveFeedCategories}>
        <input type="hidden" name="supplierId" value={id} />
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Створити дерево категорій у SalesDrive</h2>
          <p className="small muted">
            Кожен рядок — повний шлях через «›» або «&gt;». Наявні рівні не дублюються, відсутні створюються (і з’являться на сайті після синхронізації
            SalesDrive → Хорошоп).
          </p>
          <textarea name="tree" rows={8} style={{ width: "100%", fontFamily: "monospace" }} placeholder={"Мотоблоки та культиватори > Двигуни\nМотоблоки та культиватори > Фрези та навісне"} />
        </div>
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Категорія у фіді</th>
                <th>Товарів</th>
                <th>Категорія на сайті</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.count}</td>
                  <td>
                    <input name={`fc:${r.name}`} list="all-cats" defaultValue={def(r.name)} style={{ width: "100%", minWidth: 320 }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="all-cats">
            {cats.map((c) => (
              <option key={c.id} value={c.path} />
            ))}
          </datalist>
          <p style={{ marginBottom: 0 }}>
            <button className="btn primary">Зберегти (і створити дерево, якщо заповнено)</button>
          </p>
        </div>
      </form>
    </>
  );
}
