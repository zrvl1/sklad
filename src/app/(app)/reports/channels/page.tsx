import Link from "next/link";
import { db } from "@/lib/db";
import { saleStatusFilter } from "@/lib/finance";
import { dateInput, getSetting, money } from "@/lib/util";
import { backfillState } from "@/lib/orders";
import { continueBackfill, resyncOrdersYear } from "../sales/actions";

type SP = Promise<{ from?: string; to?: string; msg?: string }>;

/**
 * Канали продажів: звідки заявки (сайт + UTM-кампанія з SalesDrive), скільки з них продано, прибуток після комісії
 * і після реклами (витрати з «Гроші за місяць», у статті яких є назва кампанії: «Реклама: Google Ads — horoshop_pmax»).
 */
export default async function ChannelsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const now = new Date();
  const from = sp.from ? new Date(sp.from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = sp.to ? new Date(`${sp.to}T23:59:59`) : now;
  const saleFilter = await saleStatusFilter();
  const saleIds: number[] = "statusId" in saleFilter ? (saleFilter.statusId as { in: number[] }).in : [];

  const [orders, spend, keysRaw, statuses, bf] = await Promise.all([
    db.sdOrder.findMany({
      where: { orderTime: { gte: from, lte: to } },
      select: { statusId: true, amount: true, costAmount: true, profit: true, commission: true, site: true, utmCampaign: true, utmSource: true, utmMedium: true },
    }),
    db.expense.findMany({ where: { kind: "expense", date: { gte: from, lte: to }, category: { contains: "Реклама" } }, select: { category: true, amount: true } }),
    getSetting("sdOrderKeys"),
    db.setting.findUnique({ where: { key: "sdStatuses" } }),
    backfillState(),
  ]);
  const refusedIds = new Set<number>(
    statuses?.value ? (JSON.parse(statuses.value) as { id: number; name: string }[]).filter((s) => /відмов|поверн|скасов/i.test(s.name)).map((s) => s.id) : []
  );

  type Ch = { key: string; site: string; campaign: string; orders: number; sold: number; refused: number; revenue: number; profit: number; commission: number; spend: number };
  const chans = new Map<string, Ch>();
  for (const o of orders) {
    const site = o.site ?? "—";
    const campaign = o.utmCampaign && o.utmCampaign !== "(none)" ? o.utmCampaign : o.utmMedium === "organic" || o.utmSource === "organic" ? "органіка" : "—";
    const key = `${site} · ${campaign}`;
    const c = chans.get(key) ?? { key, site, campaign, orders: 0, sold: 0, refused: 0, revenue: 0, profit: 0, commission: 0, spend: 0 };
    c.orders++;
    if (saleIds.includes(o.statusId)) {
      c.sold++;
      c.revenue += o.amount;
      c.profit += o.profit - o.commission;
      c.commission += o.commission;
    } else if (refusedIds.has(o.statusId)) c.refused++;
    chans.set(key, c);
  }
  // витрати на рекламу → канал, назва кампанії якого є в статті (довші назви першими)
  const list = [...chans.values()];
  const byLen = [...list].filter((c) => c.campaign !== "—" && c.campaign !== "органіка").sort((a, b) => b.campaign.length - a.campaign.length);
  let unassigned = 0;
  for (const e of spend) {
    const cat = e.category.toLowerCase();
    const c = byLen.find((x) => cat.includes(x.campaign.toLowerCase())) ?? (cat.includes("prosale") ? list.find((x) => x.site.toLowerCase() === "prom" && x.campaign.toLowerCase() === "prom") : undefined);
    if (c) c.spend += e.amount;
    else unassigned += e.amount;
  }
  list.sort((a, b) => b.orders - a.orders);
  const tot = list.reduce(
    (t, c) => ({ orders: t.orders + c.orders, sold: t.sold + c.sold, revenue: t.revenue + c.revenue, profit: t.profit + c.profit, spend: t.spend + c.spend }),
    { orders: 0, sold: 0, revenue: 0, profit: 0, spend: 0 }
  );
  const hasData = orders.some((o) => o.site || o.utmCampaign);
  const keys = keysRaw ? (JSON.parse(keysRaw) as string[]) : [];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Канали й реклама</h1>
        <span className="spacer" />
        <form className="row" style={{ gap: 6 }}>
          <input type="date" name="from" defaultValue={dateInput(from)} />
          <input type="date" name="to" defaultValue={dateInput(to)} />
          <button className="btn sm">Показати</button>
        </form>
      </div>
      {sp.msg && <div className={`msg ${sp.msg.startsWith("Помилка") ? "err" : "ok"}`}>{sp.msg}</div>}
      <p className="muted small">
        Канал = сайт заявки + UTM-кампанія з SalesDrive. Прибуток — після собівартості й <b>комісії Prom</b>. Рекламу вносьте в «Гроші за місяць» зі
        статтею, де є назва кампанії: «Реклама: Google Ads — horoshop_pmax», «Реклама: Google Ads — prom_pmax», «Реклама: Prom ProSale».
      </p>
      {bf && (
        <div className="msg warn small">
          Завантаження заявок за рік у фоні: {bf.saved} заявок, сторінка {bf.page}
          {bf.pages ? ` з ${bf.pages}` : ""}. Довантажується саме кожні 2 хвилини (ліміт SalesDrive — 10 запитів за хвилину); оновіть сторінку пізніше.
          <form action={continueBackfill} style={{ marginTop: 6 }}>
            <button className="btn sm">Продовжити зараз (≈1 хв)</button>
          </form>
        </div>
      )}
      {!hasData && !bf && (
        <div className="msg warn small">
          У заявках ще немає даних про канал. Натисніть «Перезавантажити заявки за рік» — це займе кілька хвилин.
          {keys.length > 0 && <div className="muted">Поля заявки з SalesDrive: {keys.join(", ")}</div>}
        </div>
      )}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Канал</th>
              <th className="num">Заявок</th>
              <th className="num">Продано</th>
              <th className="num">Відмов / повернень</th>
              <th className="num">Виручка</th>
              <th className="num">Прибуток (після комісії)</th>
              <th className="num">Реклама</th>
              <th className="num">Прибуток після реклами</th>
              <th className="num">Окупність</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const after = c.profit - c.spend;
              return (
                <tr key={c.key}>
                  <td>
                    <b>{c.site}</b> · {c.campaign}
                  </td>
                  <td className="num">{c.orders}</td>
                  <td className="num">
                    {c.sold} <span className="muted small">({c.orders ? Math.round((c.sold / c.orders) * 100) : 0}%)</span>
                  </td>
                  <td className="num" style={{ color: c.orders && c.refused / c.orders > 0.2 ? "var(--err)" : undefined }}>
                    {c.refused} <span className="muted small">({c.orders ? Math.round((c.refused / c.orders) * 100) : 0}%)</span>
                  </td>
                  <td className="num">{money(c.revenue)}</td>
                  <td className="num">{money(c.profit)}</td>
                  <td className="num">{c.spend ? money(c.spend) : "—"}</td>
                  <td className="num" style={{ color: after < 0 ? "var(--err)" : undefined }}>
                    <b>{money(after)}</b>
                  </td>
                  <td className="num" title="Прибуток після комісії / витрати на рекламу">
                    {c.spend ? `${(c.profit / c.spend).toFixed(1)}×` : "—"}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td>
                <b>Разом</b>
              </td>
              <td className="num">{tot.orders}</td>
              <td className="num">{tot.sold}</td>
              <td />
              <td className="num">{money(tot.revenue)}</td>
              <td className="num">{money(tot.profit)}</td>
              <td className="num">{money(tot.spend + unassigned)}</td>
              <td className="num">
                <b>{money(tot.profit - tot.spend - unassigned)}</b>
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {unassigned > 0 && (
        <p className="small muted">
          Реклама без каналу: {money(unassigned)} — у статті немає назви кампанії. Додайте її, напр. «Реклама: Google Ads — horoshop_pmax».
        </p>
      )}
      <p className="small muted">
        Окупність 3× — на кожну гривню реклами 3 грн прибутку (вже після собівартості й комісії). Нижче 1× — реклама збиткова. Заявки рахуються за датою
        створення, продаж — за поточним статусом.
      </p>
      <form action={resyncOrdersYear}>
        <button className="btn sm">Перезавантажити заявки за рік (кілька хвилин)</button>
      </form>
      <p>
        <Link href="/reports/expenses">→ Гроші за місяць</Link>
      </p>
    </>
  );
}

export const maxDuration = 300;
