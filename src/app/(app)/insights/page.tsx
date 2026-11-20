import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { buildInsights } from "@/lib/insights";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LEVEL: Record<string, { label: string; bg: string }> = {
  high: { label: "Важливо", bg: "#fbebeb" },
  mid: { label: "Варто зробити", bg: "#f9eeda" },
  low: { label: "Можна покращити", bg: "#e7f1fb" },
};

// Поради: автоматичний аналіз складу, цін, відмов, реклами й карток
export default async function InsightsPage() {
  await requirePerm("reports");
  const list = await buildInsights();
  return (
    <>
      <h1>Поради</h1>
      <p className="muted small">
        Додаток щоразу перевіряє склад, ціни, відмови, рекламу (минулий місяць, з «Гроші за місяць») і картки товарів. Аналіз пошукових
        запитів Google Ads (мінус-слова) робиться за експортом звіту — надішліть його Claude раз на тиждень.
      </p>
      {list.length === 0 && <p>Усе в порядку 🎉</p>}
      {list.map((x, i) => (
        <div key={i} className="panel" style={{ borderLeft: `6px solid ${LEVEL[x.level].bg}` }}>
          <div className="small muted">
            <span style={{ background: LEVEL[x.level].bg, padding: "1px 6px", borderRadius: 4 }}>{LEVEL[x.level].label}</span> · {x.area}
          </div>
          <h3 style={{ margin: "6px 0" }}>{x.href ? <Link href={x.href}>{x.title}</Link> : x.title}</h3>
          <p className="small" style={{ margin: "4px 0" }}>
            {x.detail}
          </p>
          {x.items && x.items.length > 0 && (
            <div className="small">
              {x.items.map((it, k) => (
                <span key={k}>
                  {k > 0 && " · "}
                  <Link href={it.href}>{it.label}</Link>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
