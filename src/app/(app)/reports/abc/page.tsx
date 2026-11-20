import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { abcRows } from "@/lib/demand";
import { ua } from "@/lib/names";
import { mainImage } from "@/lib/images";
import { money } from "@/lib/util";

export const dynamic = "force-dynamic";

type SP = Promise<{ days?: string; cls?: string }>;
const COLORS: Record<string, string> = { A: "#e5f4e4", B: "#f9eeda", C: "#f0efec" };

// ABC-аналіз: які товари дають прибуток, а які лише займають гроші на полиці
export default async function AbcPage({ searchParams }: { searchParams: SP }) {
  await requirePerm("reports");
  const sp = await searchParams;
  const days = [30, 90, 180, 365].includes(Number(sp.days)) ? Number(sp.days) : 90;
  const cls = sp.cls === "A" || sp.cls === "B" || sp.cls === "C" || sp.cls === "dead" ? sp.cls : "";
  const rows = await abcRows(days);
  const sum = (c: string) => {
    const r = rows.filter((x) => x.cls === c);
    return { n: r.length, profit: r.reduce((s, x) => s + x.profit, 0), stockValue: r.reduce((s, x) => s + x.stockValue, 0) };
  };
  const dead = rows.filter((x) => x.qty === 0 && x.stock > 0);
  const deadValue = dead.reduce((s, x) => s + x.stockValue, 0);
  const list = cls === "dead" ? [...dead].sort((a, b) => b.stockValue - a.stockValue) : cls ? rows.filter((x) => x.cls === cls) : rows;
  const q = (o: Record<string, string>) => `/reports/abc?${new URLSearchParams({ days: String(days), ...(cls ? { cls } : {}), ...o })}`;

  return (
    <>
      <h1>ABC-аналіз</h1>
      <p className="muted small">
        За валовим прибутком (ціна продажу − собівартість у заявці SalesDrive, без комісій і реклами) за {days} днів. A — товари, що дають
        перші 80% прибутку, B — наступні 15%, C — решта й товари без продажів. Продажі карток-комплектів зараховано основному товару.
      </p>
      <div className="toolbar">
        {[30, 90, 180, 365].map((d) => (
          <Link key={d} className={`btn sm ${d === days ? "primary" : ""}`} href={q({ days: String(d) })}>
            {d} днів
          </Link>
        ))}
      </div>
      <div className="stats">
        {(["A", "B", "C"] as const).map((c) => {
          const s = sum(c);
          return (
            <Link key={c} className="stat" href={q({ cls: c })} style={{ background: COLORS[c] }}>
              Клас {c}
              <b>{s.n} тов.</b>
              <span className="muted small">
                прибуток {money(s.profit)} · на складі {money(s.stockValue)}
              </span>
            </Link>
          );
        })}
        <Link className="stat" href={q({ cls: "dead" })}>
          Без продажів, але є на складі
          <b>{dead.length} тов.</b>
          <span className="muted small">заморожено {money(deadValue)}</span>
        </Link>
      </div>
      <p className="small">
        Що робити: <b>A</b> — завжди в наявності, мінімальний залишок, реклама в першу чергу. <b>B</b> — тримати 1–2 шт. <b>C</b> — не
        дозамовляти без потреби. <b>Без продажів</b> — знижка, відео, реклама або розпродаж, щоб звільнити гроші.
      </p>
      <div className="toolbar">
        <Link className={`btn sm ${cls === "" ? "primary" : ""}`} href={`/reports/abc?days=${days}`}>
          Усі
        </Link>
        {(["A", "B", "C", "dead"] as const).map((c) => (
          <Link key={c} className={`btn sm ${cls === c ? "primary" : ""}`} href={`/reports/abc?days=${days}&cls=${c}`}>
            {c === "dead" ? "Без продажів" : `Клас ${c}`}
          </Link>
        ))}
      </div>
      <table>
        <thead>
          <tr>
            <th>Клас</th>
            <th style={{ width: 56 }}>Фото</th>
            <th>Товар</th>
            <th className="num">Продано, шт</th>
            <th className="num">Виручка</th>
            <th className="num">Прибуток</th>
            <th className="num">Частка / накопич.</th>
            <th className="num">Залишок</th>
            <th className="num">На складі, грн</th>
          </tr>
        </thead>
        <tbody>
          {list.slice(0, 500).map((r) => {
            const img = mainImage(r.images);
            return (
              <tr key={r.id}>
                <td style={{ background: COLORS[r.cls], textAlign: "center" }}>
                  <b>{r.cls}</b>
                </td>
                <td>{img ? <img src={img} alt="" loading="lazy" style={{ width: 40, height: 40, objectFit: "contain", background: "#fff", borderRadius: 6 }} /> : null}</td>
                <td>
                  <Link href={`/products/${r.id}`}>{ua(r)}</Link>
                  <div className="muted small">{r.sku}</div>
                </td>
                <td className="num">{r.qty}</td>
                <td className="num">{money(r.revenue)}</td>
                <td className="num">{money(r.profit)}</td>
                <td className="num">
                  {r.share.toFixed(1)}% / {Math.min(100, r.cum).toFixed(0)}%
                </td>
                <td className="num">{r.stock}</td>
                <td className="num">{money(r.stockValue)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
