import { ua } from "@/lib/names";
import { mainImage } from "@/lib/images";
import Link from "next/link";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { saveFill, translateRuFromUa, translateUaKeywords } from "./actions";
import { langIssues, uaKwMissing } from "@/lib/langcheck";
import SelectAllButton from "@/components/SelectAllButton";

type SP = Promise<{ f?: string; q?: string; page?: string; msg?: string; warn?: string }>;
const PER = 50;
const FILTERS: Record<string, string> = {
  cost: "Без собівартості",
  man: "Без бренду",
  country: "Без країни",
  kw: "Без ключових слів",
  kwua: "Ключові UA = RU",
  lang: "Змішана мова (RU/UA)",
  cell: "Без комірки (є залишок)",
  all: "Усі основні товари",
};

// Масове заповнення: виробник, собівартість, комірка — по 50 товарів на сторінку
export default async function FillPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const f = sp.f && sp.f in FILTERS ? sp.f : "cost";
  const q = (sp.q ?? "").trim().toLowerCase();
  const page = Math.max(1, Number(sp.page) || 1);

  // змішана мова — перевіряємо в коді (усі товари, разом із картками: у них свої назви)
  const langIds = (
    await db.product.findMany({ where: { deletedAt: null }, select: { id: true, name: true, nameTranslate: true, description: true, descriptionTranslate: true } })
  )
    .filter((p) => langIssues(p).length > 0)
    .map((p) => p.id);
  const kwuaIds = (
    await db.product.findMany({ where: { deletedAt: null, keywords: { not: null } }, select: { id: true, keywords: true, keywordsUa: true } })
  )
    .filter((p) => p.keywords?.trim() && uaKwMissing(p.keywordsUa, p.keywords))
    .map((p) => p.id);
  const base: Prisma.ProductWhereInput = { deletedAt: null, baseProductId: null, ...(q ? { search: { contains: q } } : {}) };
  const where: Prisma.ProductWhereInput =
    f === "cost"
      ? { ...base, cost: { lte: 0 } }
      : f === "man"
        ? { ...base, OR: [{ manufacturer: null }, { manufacturer: "" }] }
        : f === "country"
          ? { ...base, OR: [{ country: null }, { country: "" }] }
        : f === "kwua"
          ? { deletedAt: null, id: { in: kwuaIds }, ...(q ? { search: { contains: q } } : {}) }
        : f === "lang"
          ? { deletedAt: null, id: { in: langIds }, ...(q ? { search: { contains: q } } : {}) }
        : f === "kw"
          ? { ...base, OR: [{ keywords: null }, { keywords: "" }] }
        : f === "cell"
          ? { ...base, stocks: { some: { qty: { gt: 0 } } }, cells: { none: { qty: { gt: 0 } } } }
          : base;

  const [counts, total, rows, cells, mans] = await Promise.all([
    Promise.all([
      db.product.count({ where: { deletedAt: null, baseProductId: null, cost: { lte: 0 } } }),
      db.product.count({ where: { deletedAt: null, baseProductId: null, OR: [{ manufacturer: null }, { manufacturer: "" }] } }),
      db.product.count({ where: { deletedAt: null, baseProductId: null, OR: [{ country: null }, { country: "" }] } }),
      db.product.count({ where: { deletedAt: null, baseProductId: null, OR: [{ keywords: null }, { keywords: "" }] } }),
      Promise.resolve(kwuaIds.length),
      Promise.resolve(langIds.length),
      db.product.count({ where: { deletedAt: null, baseProductId: null, stocks: { some: { qty: { gt: 0 } } }, cells: { none: { qty: { gt: 0 } } } } }),
    ]),
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: [{ sku: "asc" }],
      skip: (page - 1) * PER,
      take: PER,
      include: { stocks: true, cells: { where: { qty: { gt: 0 } }, include: { cell: true } }, _count: { select: { kits: true } } },
    }),
    db.cell.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true } }),
    db.product.findMany({ where: { manufacturer: { not: null } }, distinct: ["manufacturer"], select: { manufacturer: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER));
  const qs = (o: Record<string, string | number>) => {
    const u = new URLSearchParams({ f, ...(q ? { q } : {}), page: String(page) });
    for (const [k, v] of Object.entries(o)) u.set(k, String(v));
    return `/products/fill?${u}`;
  };
  const back = qs({});

  return (
    <>
      <h1>Заповнення даних</h1>
      {sp.msg && <div className="msg ok">{sp.msg}</div>}
      {sp.warn && <div className="msg warn">{sp.warn}</div>}
      <div className="toolbar">
        {Object.entries(FILTERS).map(([k, t], i) => (
          <Link key={k} className={`btn sm ${f === k ? "primary" : ""}`} href={`/products/fill?f=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>
            {t}
            {i < 7 ? ` (${counts[i]})` : ""}
          </Link>
        ))}
        <form className="row" style={{ gap: 6 }}>
          <input type="hidden" name="f" value={f} />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="назва, артикул, штрихкод" />
          <button className="btn sm">Знайти</button>
        </form>
      </div>
      <p className="muted small">
        Лише основні товари (картки-комплекти беруть усе з основного). Виробник і собівартість ідуть у SalesDrive, комірка — лише в додатку. Порожнє поле
        собівартості — без змін. Комірку зручно ставити, коли стоїте біля полиці: оберіть комірку, кількість підставиться із залишку.
      </p>

      {f === "kwua" && (
        <form action={translateUaKeywords} className="panel small" style={{ marginBottom: 12 }}>
          <b>Українські ключові слова</b> — там, де їх немає або там копія російських: перекласти російські через DeepL, зберегти й
          зберегти в картках. На Prom — файлом з Налаштувань (SalesDrive має лише одне поле ключових слів). По 150 товарів за раз.{" "}
          <button className="btn sm primary">🌐 Перекласти ключові RU → UA</button>
        </form>
      )}
      {f === "lang" && (
        <form action={translateRuFromUa} className="panel small" style={{ marginBottom: 12 }}>
          <b>Російські описи й назви з українським текстом</b> — перекласти з української версії через DeepL (з HTML) і відправити в
          SalesDrive. По 100 товарів за раз; українська версія не змінюється.{" "}
          <button className="btn sm primary">🌐 Перекласти UA → RU (100 товарів)</button>
        </form>
      )}
      <form action={saveFill}>
        <input type="hidden" name="back" value={back} />
        <datalist id="countries">
          {["Китай", "Індія", "Тайвань", "Японія", "Італія", "Україна", "Польща"].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="mans">
          {mans.map((m) => (
            <option key={m.manufacturer!} value={m.manufacturer!} />
          ))}
        </datalist>
        <div className="toolbar">
          <label className="row" style={{ gap: 6 }}>
            Для позначених — бренд:
            <input name="bulkManufacturer" list="mans" placeholder="напр. WLJF" style={{ width: 160 }} />
          </label>
          <label className="row" style={{ gap: 6 }}>
            країна:
            <input name="bulkCountry" list="countries" placeholder="Китай" style={{ width: 120 }} />
          </label>
          <SelectAllButton />
          <button className="btn primary">Зберегти сторінку</button>
          <span className="muted small">
            {total} товарів · сторінка {page} з {pages}
          </span>
        </div>
        <div className="tablewrap">
          <table className="small">
            <thead>
              <tr>
                <th style={{ width: 24 }} />
                <th style={{ width: 60 }}>Фото</th>
                <th>Товар</th>
                <th className="num">Залишок</th>
                <th className="num">Ціна</th>
                <th>Собівартість, грн</th>
                <th>Бренд</th>
                <th>Країна</th>
                <th>Комірка</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const stock = p.stocks.reduce((s, x) => s + x.qty, 0);
                const inCells = p.cells.reduce((s, x) => s + x.qty, 0);
                return (
                  <tr key={p.id}>
                    <td>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="checkbox" name={`sel_${p.id}`} value="1" title="Позначити для масового виробника" />
                    </td>
                    <td>
                      {mainImage(p.images) ? (
                        <a href={mainImage(p.images)!} target="_blank" rel="noreferrer" title="Відкрити фото">
                          <img
                            src={mainImage(p.images)!}
                            alt=""
                            loading="lazy"
                            style={{ width: 52, height: 52, objectFit: "contain", background: "#fff", borderRadius: 6, border: "1px solid var(--line)", display: "block" }}
                          />
                        </a>
                      ) : (
                        <Link href={`/products/${p.id}`} className="muted small" title="Додати фото">
                          + фото
                        </Link>
                      )}
                    </td>
                    <td>
                      <Link href={`/products/${p.id}`}>{ua(p)}</Link>
                      {f === "lang" &&
                        langIssues(p).map((x) => (
                          <div key={x.field} className="small" style={{ color: "var(--err)" }}>
                            {x.field}: {x.words.join(", ")}
                          </div>
                        ))}
                      <div className="muted">
                        {p.sku ?? "—"}
                        {p._count.kits ? ` · +${p._count.kits} карток` : ""}
                      </div>
                    </td>
                    <td className="num">{stock}</td>
                    <td className="num">{p.price}</td>
                    <td>
                      <input name={`c_${p.id}`} inputMode="decimal" placeholder={p.cost > 0 ? String(p.cost) : "0 — вкажіть"} style={{ width: 100 }} />
                    </td>
                    <td>
                      <input name={`m_${p.id}`} list="mans" defaultValue={p.manufacturer ?? ""} style={{ width: 130 }} />
                    </td>
                    <td>
                      <input name={`k_${p.id}`} list="countries" defaultValue={p.country ?? ""} style={{ width: 90 }} />
                    </td>
                    <td>
                      {p.cells.length > 0 && (
                        <div className="muted">
                          {p.cells.map((c) => `${c.cell.code}: ${c.qty}`).join(", ")}
                        </div>
                      )}
                      {cells.length > 0 ? (
                        <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                          <select name={`cell_${p.id}`} defaultValue="">
                            <option value="">—</option>
                            {cells.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.code}
                              </option>
                            ))}
                          </select>
                          <input name={`cq_${p.id}`} type="number" min={0} step="any" defaultValue={Math.max(0, stock - inCells) || ""} style={{ width: 60 }} title="Скільки штук у цій комірці" />
                        </span>
                      ) : (
                        <Link href="/settings" className="muted">
                          створіть комірки
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    Усе заповнено 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="toolbar" style={{ marginTop: 10 }}>
          <button className="btn primary">Зберегти сторінку</button>
          {page > 1 && (
            <Link className="btn sm" href={qs({ page: page - 1 })}>
              ← Попередня
            </Link>
          )}
          {page < pages && (
            <Link className="btn sm" href={qs({ page: page + 1 })}>
              Наступна →
            </Link>
          )}
        </div>
      </form>
    </>
  );
}
