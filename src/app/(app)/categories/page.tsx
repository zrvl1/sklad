import Link from "next/link";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { allCategories, PATH_SEP } from "@/lib/categories";
import { addCategory, editCategory, removeCategory } from "./actions";
import CategoryTreeToggle from "@/components/CategoryTreeToggle";
import CategoryTreeSelect from "@/components/CategoryTreeSelect";

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ msg?: string; edit?: string; del?: string }> }) {
  await requirePerm("products.edit");
  const sp = await searchParams;
  const [cats, counts] = await Promise.all([
    allCategories(),
    db.product.groupBy({ by: ["categorySdId"], where: { deletedAt: null, baseProductId: null }, _count: { _all: true } }),
  ]);
  const countOf = new Map<string | null, number>(counts.map((c) => [c.categorySdId, Number(c._count._all)]));
  // всередині гілки — разом із підкатегоріями
  const total = (id: string, path: string) =>
    cats.filter((c) => c.id === id || c.path.startsWith(path + PATH_SEP)).reduce((s, c) => s + (countOf.get(c.id) ?? 0), 0);
  // не можна переносити категорію в саму себе чи в свою підкатегорію
  const parentsFor = (path: string) => cats.filter((c) => c.path !== path && !c.path.startsWith(path + PATH_SEP));

  return (
    <>
      <h1>Категорії</h1>
      {sp.msg && <div className="msg">{sp.msg}</div>}
      <p className="muted small">
        Дерево категорій SalesDrive. Нові категорії й зміни одразу передаються в SalesDrive, а звідти — на сайт і Prom. Порожні категорії, створені
        прямо в SalesDrive, тут видно лише після появи в них товарів (SalesDrive не віддає їх у вивантаженні) — створюйте нові тут.
      </p>

      <form action={addCategory} className="panel toolbar" style={{ flexWrap: "wrap" }}>
        <b>＋ Нова категорія</b>
        <input name="name" placeholder="Назва, напр. Моторна олива" required style={{ minWidth: 260 }} />
        <span className="small muted">у розділі</span>
        <CategoryTreeSelect options={cats} name="parentId" mode="id" emptyLabel="— верхній рівень —" placeholder="— верхній рівень —" style={{ minWidth: 340 }} />
        <button className="btn primary">Створити в SalesDrive</button>
      </form>

      <div className="panel">
        {cats.length === 0 ? (
          <p className="muted">Категорій ще немає. Натисніть «⟳ Завантажити товари з SalesDrive» в Налаштуваннях.</p>
        ) : (
          <>
          <CategoryTreeToggle tableId="cat-tree" />
          <table id="cat-tree">
            <thead>
              <tr>
                <th>Категорія</th>
                <th style={{ width: 90 }}>Товарів</th>
                <th style={{ width: 120 }}>ID</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) =>
                sp.del === c.id ? (
                  <tr key={c.id} data-path={c.path} data-focus="1">
                    <td colSpan={4} style={{ background: "#fef2f2" }}>
                      <form action={removeCategory} className="stack">
                        <input type="hidden" name="id" value={c.id} />
                        <b>Видалити категорію «{c.path}»?</b>
                        {(() => {
                          const own = countOf.get(c.id) ?? 0;
                          const kids = cats.filter((x) => x.parentId === c.id);
                          const parent = cats.find((x) => x.id === c.parentId);
                          return (
                            <>
                              {own > 0 ? (
                                <label>
                                  У категорії {own} товарів. Перенести їх у:
                                  <CategoryTreeSelect
                                    options={parentsFor(c.path)}
                                    name="targetId"
                                    mode="id"
                                    defaultValue={parent?.id ?? ""}
                                    placeholder="— оберіть категорію —"
                                    style={{ minWidth: 340 }}
                                  />
                                </label>
                              ) : (
                                <span className="small muted">Товарів у самій категорії немає.</span>
                              )}
                              {kids.length > 0 && (
                                <span className="small">
                                  Підкатегорії ({kids.map((k) => k.name).join(", ")}) не видаляються — піднімуться на рівень вище
                                  {parent ? ` у «${parent.name}»` : " (на верхній рівень)"} разом зі своїми товарами.
                                </span>
                              )}
                              <span className="small muted">Категорію буде видалено і в SalesDrive; товари отримають нову категорію там теж.</span>
                            </>
                          );
                        })()}
                        <div className="row">
                          <button className="btn danger sm">Так, видалити</button>
                          <Link className="btn sm" href="/categories">
                            Скасувати
                          </Link>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : sp.edit === c.id ? (
                  <tr key={c.id} data-path={c.path} data-focus="1">
                    <td colSpan={4}>
                      <form action={editCategory} className="toolbar" style={{ flexWrap: "wrap" }}>
                        <input type="hidden" name="id" value={c.id} />
                        <input name="name" defaultValue={c.name} required style={{ minWidth: 240 }} />
                        <span className="small muted">у розділі</span>
                        <CategoryTreeSelect
                          options={parentsFor(c.path)}
                          name="parentId"
                          mode="id"
                          defaultValue={c.parentId ?? ""}
                          emptyLabel="— верхній рівень —"
                          placeholder="— верхній рівень —"
                          style={{ minWidth: 340 }}
                        />
                        <button className="btn primary sm">Зберегти</button>
                        <Link className="btn sm" href="/categories">
                          Скасувати
                        </Link>
                        <Link className="btn sm danger" href={`/categories?del=${encodeURIComponent(c.id)}`} style={{ marginLeft: "auto" }}>
                          Видалити…
                        </Link>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} data-path={c.path}>
                    <td style={{ paddingLeft: 8 + c.depth * 22 }}>
                      {cats.some((x) => x.parentId === c.id) ? (
                        <>
                          <button type="button" data-toggle={c.path} className="btn sm" style={{ padding: "0 6px", marginRight: 4, minWidth: 24 }}>
                            ▸
                          </button>
                          <b>📂 {c.name}</b>{" "}
                          <span className="small muted">({cats.filter((x) => x.parentId === c.id).length})</span>
                        </>
                      ) : (
                        <>
                          <span style={{ display: "inline-block", width: 28 }}>{c.depth ? "└" : ""}</span>📁 {c.name}
                        </>
                      )}
                    </td>
                    <td>
                      <Link href={`/products?q=${encodeURIComponent(c.name)}`}>{total(c.id, c.path)}</Link>
                    </td>
                    <td className="small muted">{c.id}</td>
                    <td>
                      <Link className="btn sm" href={`/categories?edit=${encodeURIComponent(c.id)}`}>
                        Змінити
                      </Link>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
          </>
        )}
      </div>
    </>
  );
}
