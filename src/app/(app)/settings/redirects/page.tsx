import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { getSetting } from "@/lib/util";
import type { Redirect } from "@/lib/redirects";
import { buildRedirects } from "./actions";

export default async function RedirectsPage({ searchParams }: { searchParams: Promise<{ msg?: string; f?: string }> }) {
  await requirePerm("settings");
  const sp = await searchParams;
  let list: Redirect[] = [];
  try {
    list = JSON.parse((await getSetting("redirects404")) ?? "[]");
  } catch {}
  const shown = sp.f ? list.filter((r) => r.kind === sp.f) : list;
  const count = (k: string) => list.filter((r) => r.kind === k).length;
  return (
    <>
      <p>
        <Link href="/settings">← Налаштування</Link>
      </p>
      <h1>Редиректи 404 → нові сторінки</h1>
      {sp.msg && <div className="msg">{sp.msg}</div>}
      <p className="muted small">
        Завантажте експорт Search Console «Не знайдено (404)» (.xlsx) — додаток візьме поточні сторінки з sitemap сайту і підбере для кожної старої
        адреси найсхожішу нову: товар, а якщо схожого немає — розділ каталогу. Перевірте список і завантажте CSV для Horoshop (SEO → Редиректи 301).
      </p>
      <form action={buildRedirects} className="panel toolbar" style={{ flexWrap: "wrap" }}>
        <input type="file" name="file" accept=".xlsx,.csv,.txt" required />
        <button className="btn primary">Підібрати редиректи</button>
      </form>
      {list.length > 0 && (
        <div className="panel">
          <div className="toolbar" style={{ marginTop: 0, flexWrap: "wrap" }}>
            <Link className={`btn sm${!sp.f ? " primary" : ""}`} href="/settings/redirects">
              Усі ({list.length})
            </Link>
            <Link className={`btn sm${sp.f === "товар" ? " primary" : ""}`} href="/settings/redirects?f=товар">
              На товар ({count("товар")})
            </Link>
            <Link className={`btn sm${sp.f === "категорія" ? " primary" : ""}`} href="/settings/redirects?f=категорія">
              На категорію ({count("категорія")})
            </Link>
            <Link className={`btn sm${sp.f === "головна" ? " primary" : ""}`} href="/settings/redirects?f=головна">
              На головну ({count("головна")})
            </Link>
            <span className="spacer" />
            <a className="btn primary sm" href="/api/seo/redirects?full=1">
              ⬇ Excel (повні посилання)
            </a>
            <a className="btn sm" href="/api/seo/redirects">
              ⬇ Excel (без домену)
            </a>
            <a className="btn sm" href="/api/seo/redirects?full=1&fmt=csv">
              ⬇ CSV через кому
            </a>
          </div>
          <table className="small">
            <thead>
              <tr>
                <th>Стара адреса (404)</th>
                <th>Нова адреса</th>
                <th>Куди</th>
                <th className="num">Схожість</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.from}>
                  <td style={{ wordBreak: "break-all" }}>{r.from}</td>
                  <td style={{ wordBreak: "break-all" }}>
                    <a href={`https://crane-moto.com${r.to}`} target="_blank" rel="noreferrer">
                      {r.to}
                    </a>
                  </td>
                  <td>{r.kind}</td>
                  <td className="num" style={{ color: r.kind === "товар" && r.score < 0.6 ? "var(--warn)" : undefined }}>
                    {r.score}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
