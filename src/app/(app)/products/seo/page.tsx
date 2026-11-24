import Link from "next/link";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { allCategories } from "@/lib/categories";
import { seoWhere } from "@/lib/seoFile";
import CategoryTreeSelect from "@/components/CategoryTreeSelect";
import { importSeo } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function SeoPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  await requirePerm("products.edit");
  const sp = await searchParams;
  const [fresh, feed, done, cats] = await Promise.all([
    db.product.count({ where: seoWhere("new", {}) }),
    db.product.count({ where: seoWhere("feed", {}) }),
    db.product.count({ where: { seoAt: { not: null }, deletedAt: null } }),
    allCategories(),
  ]);
  const latest = await db.product.findMany({ where: seoWhere("new", {}), orderBy: { id: "desc" }, take: 15, select: { id: true, name: true, nameTranslate: true } });
  return (
    <>
      <h1>SEO-тексти файлом</h1>
      {sp.msg && <div className="msg">{sp.msg}</div>}
      {sp.err && <div className="msg err">{sp.err}</div>}
      <p className="muted small">
        Вивантажте файл з товарами → допишіть у колонку «Підказка» сумісність чи нотатки (необов’язково) → надішліть файл у чат Claude з проханням
        «заповни SEO» → завантажте отриманий файл нижче. Назви, описи, пошукові запити й характеристики оновляться в додатку й SalesDrive.
      </p>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>1. Вивантажити</h2>
        <p>
          <a className="btn primary" href="/api/export/seo?scope=new&limit=100">
            ⬇ Нові з XML без SEO ({fresh})
          </a>{" "}
          <span className="small muted">до 100 товарів за раз — так зручніше обробляти</span>
        </p>
        <form action="/api/export/seo" method="get" className="row" style={{ gap: 8, marginBottom: 8 }}>
          <input type="hidden" name="scope" value="category" />
          <span>Уся категорія:</span>
          <CategoryTreeSelect options={cats} name="cat" mode="id" placeholder="оберіть категорію" style={{ minWidth: 320 }} />
          <input type="hidden" name="limit" value="300" />
          <button className="btn sm">⬇ Вивантажити</button>
        </form>
        <form action="/api/export/seo" method="get" className="row" style={{ gap: 8 }}>
          <span>За ID:</span>
          <input name="ids" placeholder="напр. 1520, 1521, 1534" style={{ minWidth: 260 }} />
          <button className="btn sm">⬇ Вивантажити</button>
          <span className="small muted">
            усі товари з XML: {feed} · SEO завантажено: {done}
          </span>
        </form>
        {latest.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="small">Останні без SEO</summary>
            <ul className="small">
              {latest.map((p) => (
                <li key={p.id}>
                  <Link href={`/products/${p.id}`}>{p.nameTranslate || p.name}</Link> <span className="muted">ID {p.id}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>2. Завантажити заповнений файл</h2>
        <form action={importSeo} className="row" style={{ gap: 8 }}>
          <input type="file" name="file" accept=".xlsx" required />
          <button className="btn primary">⬆ Завантажити й оновити товари</button>
        </form>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Оновлюються лише заповнені колонки «НОВА назва», «НОВИЙ опис», «Запити», «Характеристики додати/змінити»; порожні не чіпають товар. Товар
          більше не потрапляє у «Нові без SEO».
        </p>
      </div>
    </>
  );
}
