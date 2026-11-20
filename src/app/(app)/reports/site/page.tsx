import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { ga4, ga4Configured, googleConfigured, gsc, saEmail, type Row } from "@/lib/google";
import { money } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SP = Promise<{ days?: string }>;
const n = (v: unknown) => Number(v ?? 0);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const delta = (now: number, prev: number) => {
  if (!prev) return null;
  const d = ((now - prev) / prev) * 100;
  return <span style={{ color: d >= 0 ? "#1a7f37" : "#c62828" }}> {d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(0)}%</span>;
};
async function safe<T>(f: () => Promise<T>): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await f(), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
const CH: Record<string, string> = {
  "Organic Search": "Пошук Google (безкоштовно)",
  Direct: "Прямі заходи",
  "Paid Search": "Google Ads (пошук)",
  "Cross-network": "Google Ads (PMax)",
  "Paid Shopping": "Google Ads (Shopping)",
  "Organic Shopping": "Google Покупки (безкоштовно)",
  Referral: "Переходи з інших сайтів",
  "Organic Social": "Соцмережі",
  "Paid Social": "Реклама в соцмережах",
  "AI Assistant": "ChatGPT / Gemini / AI",
  Email: "Email",
  Unassigned: "Не визначено",
};

// Сайт і реклама: головне з GA4 і Search Console простими словами
export default async function SitePage({ searchParams }: { searchParams: SP }) {
  await requirePerm("reports");
  const sp = await searchParams;
  const days = [7, 28, 90].includes(Number(sp.days)) ? Number(sp.days) : 28;

  if (!googleConfigured() || !ga4Configured()) {
    return (
      <>
        <h1>Сайт і реклама</h1>
        <div className="panel">
          <p>Щоб тут зʼявились дані з Google Analytics і Search Console, потрібен доступ лише на читання (≈10 хвилин):</p>
          <ol className="small">
            <li>console.cloud.google.com → створити проєкт → «APIs &amp; Services» → увімкнути <b>Google Analytics Data API</b> і <b>Google Search Console API</b>.</li>
            <li>«IAM та адміністрування» → «Сервісні акаунти» → «Створити» → відкрити акаунт → «Ключі» → «Додати ключ» → JSON (файл нікому не пересилайте).</li>
            <li>GA4 → Адміністратор → «Керування доступом до ресурсу» → «+» → email сервісного акаунта, роль <b>Читач</b>.</li>
            <li>Search Console → Налаштування → «Користувачі та дозволи» → додати той самий email з дозволом <b>Обмежений</b>.</li>
            <li>Vercel → Settings → Environment Variables: <code>GOOGLE_SA_JSON</code> = весь вміст JSON-файлу; <code>GA4_PROPERTY_ID</code> = 458420067 → Redeploy.</li>
          </ol>
          {saEmail() && <p className="small">Сервісний акаунт: {saEmail()}</p>}
        </div>
      </>
    );
  }

  const base = ["activeUsers", "sessions", "ecommercePurchases", "purchaseRevenue"];
  const [sumNow, sumPrev, channels, ads, adsCost, items, search, queries, pages] = await Promise.all([
    safe(() => ga4({ metrics: base, days })),
    safe(() => ga4({ metrics: base, days, offsetDays: days })),
    safe(() => ga4({ dimensions: ["sessionDefaultChannelGroup"], metrics: ["sessions", "ecommercePurchases", "purchaseRevenue"], days, orderBy: "sessions" })),
    safe(() => ga4({ dimensions: ["sessionGoogleAdsCampaignName"], metrics: ["sessions", "ecommercePurchases", "purchaseRevenue"], days, orderBy: "sessions" })),
    safe(() => ga4({ dimensions: ["sessionGoogleAdsCampaignName"], metrics: ["advertiserAdCost", "advertiserAdClicks"], days, ukraineOnly: false, orderBy: "advertiserAdCost" })),
    safe(() => ga4({ dimensions: ["itemName"], metrics: ["itemsViewed", "itemsAddedToCart", "itemsPurchased", "itemRevenue"], days, orderBy: "itemsViewed", limit: 200 })),
    safe(() =>
      ga4({ dimensions: ["searchTerm"], metrics: ["eventCount"], days, orderBy: "eventCount", filter: { filter: { fieldName: "eventName", stringFilter: { value: "view_search_results" } } } })
    ),
    safe(() => gsc("query", days, 500)),
    safe(() => gsc("page", days, 200)),
  ]);

  const s = sumNow.data?.[0] ?? {};
  const p = sumPrev.data?.[0] ?? {};
  const costByCamp = new Map<string, Row>((adsCost.data ?? []).map((r) => [String(r.sessionGoogleAdsCampaignName), r]));
  const totalCost = [...costByCamp.values()].reduce((t, r) => t + n(r.advertiserAdCost), 0);

  // висновки
  const tips: string[] = [];
  const conv = n(s.sessions) ? n(s.ecommercePurchases) / n(s.sessions) : 0;
  if (n(s.sessions) > 100 && conv < 0.005) tips.push("Конверсія сайту нижче 0,5%: перевірте, що кнопка «Купити» працює, ціни й наявність актуальні, а оформлення замовлення просте.");
  const lookNoBuy = (items.data ?? []).filter((r) => n(r.itemsViewed) >= 15 && n(r.itemsPurchased) === 0);
  if (lookNoBuy.length) tips.push(`${lookNoBuy.length} товарів часто переглядають, але не купують — перевірте ціну проти Prom, фото, сумісність у назві й наявність (список нижче).`);
  const cartNoBuy = (items.data ?? []).filter((r) => n(r.itemsAddedToCart) >= 3 && n(r.itemsPurchased) === 0);
  if (cartNoBuy.length) tips.push(`${cartNoBuy.length} товарів додають у кошик, але не замовляють — можливо, дорога доставка або незручне оформлення.`);
  const opp = (queries.data ?? []).filter((q) => q.impressions >= 30 && q.position >= 4 && q.position <= 20).sort((a, b) => b.impressions - a.impressions);
  if (opp.length) tips.push(`${opp.length} пошукових запитів, де сайт на 4–20 місці: допрацюйте відповідні товари чи категорії (назва, опис, сумісність) — це найшвидший приріст безкоштовного трафіку.`);
  for (const [camp, c] of costByCamp) {
    const rev = n((ads.data ?? []).find((r) => r.sessionGoogleAdsCampaignName === camp)?.purchaseRevenue);
    if (n(c.advertiserAdCost) > 300 && rev / n(c.advertiserAdCost) < 2)
      tips.push(`Кампанія «${camp}»: витрати ${money(n(c.advertiserAdCost))} грн, продажі за GA4 ${money(rev)} грн — окупність нижче 2×. Перегляньте пошукові запити й товари в кампанії.`);
  }
  const noResults = (search.data ?? []).slice(0, 15);

  const err = (e: string | null) => (e ? <div className="msg warn small">Не вдалося отримати: {e}</div> : null);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Сайт і реклама</h1>
        <span className="spacer" />
        {[7, 28, 90].map((d) => (
          <Link key={d} className={`btn sm ${d === days ? "primary" : ""}`} href={`/reports/site?days=${d}`}>
            {d} днів
          </Link>
        ))}
      </div>
      <p className="muted small">Дані GA4 — лише відвідувачі з України (боти з інших країн відкинуто). Search Console — із затримкою 3 дні. Порівняння — з попереднім таким самим періодом.</p>
      {err(sumNow.error)}

      <div className="stats">
        <div className="stat">
          Відвідувачі
          <b>{n(s.activeUsers)}</b>
          {delta(n(s.activeUsers), n(p.activeUsers))}
        </div>
        <div className="stat">
          Покупки на сайті
          <b>{n(s.ecommercePurchases)}</b>
          {delta(n(s.ecommercePurchases), n(p.ecommercePurchases))}
        </div>
        <div className="stat">
          Дохід сайту (GA4)
          <b>{money(n(s.purchaseRevenue))}</b>
          {delta(n(s.purchaseRevenue), n(p.purchaseRevenue))}
        </div>
        <div className="stat">
          Конверсія
          <b>{pct(n(s.ecommercePurchases), n(s.sessions))}</b>
          <span className="muted small">покупок на 100 візитів</span>
        </div>
        <div className="stat">
          Google Ads: витрати
          <b>{money(totalCost)}</b>
          <span className="muted small">ROAS {totalCost ? (n(s.purchaseRevenue) / totalCost).toFixed(1) : "—"}×</span>
        </div>
      </div>

      {tips.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Що зробити</h2>
          <ul className="small">
            {tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid2">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Звідки приходять</h2>
          {err(channels.error)}
          <table className="small">
            <thead>
              <tr>
                <th>Джерело</th>
                <th className="num">Візити</th>
                <th className="num">Покупки</th>
                <th className="num">Дохід</th>
              </tr>
            </thead>
            <tbody>
              {(channels.data ?? []).map((r) => (
                <tr key={String(r.sessionDefaultChannelGroup)}>
                  <td>{CH[String(r.sessionDefaultChannelGroup)] ?? r.sessionDefaultChannelGroup}</td>
                  <td className="num">{n(r.sessions)}</td>
                  <td className="num">{n(r.ecommercePurchases)}</td>
                  <td className="num">{money(n(r.purchaseRevenue))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Кампанії Google Ads</h2>
          {err(ads.error || adsCost.error)}
          <table className="small">
            <thead>
              <tr>
                <th>Кампанія</th>
                <th className="num">Витрати</th>
                <th className="num">Кліки</th>
                <th className="num">Покупки</th>
                <th className="num">Дохід</th>
                <th className="num">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {[...new Set<string>([...costByCamp.keys(), ...(ads.data ?? []).map((r) => String(r.sessionGoogleAdsCampaignName))])]
                .filter((c) => c && c !== "(not set)")
                .map((c) => {
                  const cost = n(costByCamp.get(c)?.advertiserAdCost);
                  const a = (ads.data ?? []).find((r) => r.sessionGoogleAdsCampaignName === c);
                  return (
                    <tr key={c}>
                      <td>{c}</td>
                      <td className="num">{money(cost)}</td>
                      <td className="num">{n(costByCamp.get(c)?.advertiserAdClicks)}</td>
                      <td className="num">{n(a?.ecommercePurchases)}</td>
                      <td className="num">{money(n(a?.purchaseRevenue))}</td>
                      <td className="num">{cost ? `${(n(a?.purchaseRevenue) / cost).toFixed(1)}×` : "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p className="muted small">Точний прибуток з урахуванням собівартості й відмов — у «Канали й реклама».</p>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Товари: дивляться, але не купують</h2>
        {err(items.error)}
        <table className="small">
          <thead>
            <tr>
              <th>Товар</th>
              <th className="num">Переглядів</th>
              <th className="num">У кошик</th>
              <th className="num">Куплено</th>
            </tr>
          </thead>
          <tbody>
            {[...lookNoBuy, ...cartNoBuy.filter((x) => !lookNoBuy.includes(x))].slice(0, 30).map((r) => (
              <tr key={String(r.itemName)}>
                <td>
                  <Link href={`/products?q=${encodeURIComponent(String(r.itemName).slice(0, 40))}`}>{String(r.itemName)}</Link>
                </td>
                <td className="num">{n(r.itemsViewed)}</td>
                <td className="num">{n(r.itemsAddedToCart)}</td>
                <td className="num">{n(r.itemsPurchased)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid2">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Google: запити, які можна підтягнути в топ</h2>
          <p className="muted small">Сайт уже показується на 4–20 місці — трохи кращий опис або назва дадуть кліки.</p>
          {err(queries.error)}
          <table className="small">
            <thead>
              <tr>
                <th>Запит</th>
                <th className="num">Покази</th>
                <th className="num">Кліки</th>
                <th className="num">Позиція</th>
              </tr>
            </thead>
            <tbody>
              {opp.slice(0, 25).map((q) => (
                <tr key={q.key}>
                  <td>{q.key}</td>
                  <td className="num">{q.impressions}</td>
                  <td className="num">{q.clicks}</td>
                  <td className="num">{q.position.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Що шукають на сайті</h2>
          <p className="muted small">Якщо такого товару немає — ідея для асортименту.</p>
          {err(search.error)}
          <table className="small">
            <tbody>
              {noResults.map((r) => (
                <tr key={String(r.searchTerm)}>
                  <td>{String(r.searchTerm)}</td>
                  <td className="num">{n(r.eventCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Google: найкращі сторінки</h2>
        {err(pages.error)}
        <table className="small">
          <thead>
            <tr>
              <th>Сторінка</th>
              <th className="num">Кліки</th>
              <th className="num">Покази</th>
              <th className="num">Позиція</th>
            </tr>
          </thead>
          <tbody>
            {(pages.data ?? [])
              .sort((a, b) => b.clicks - a.clicks)
              .slice(0, 20)
              .map((q) => (
                <tr key={q.key}>
                  <td style={{ wordBreak: "break-all" }}>{decodeURI(q.key).replace(/^https?:\/\/[^/]+/, "")}</td>
                  <td className="num">{q.clicks}</td>
                  <td className="num">{q.impressions}</td>
                  <td className="num">{q.position.toFixed(1)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
