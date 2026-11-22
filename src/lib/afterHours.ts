/**
 * Нові заявки в неробочий час: статус «Новий» → «Новий СМС» (у SalesDrive на цей статус стоїть автоSMS
 * «прийнято, опрацюємо з 10:00 і відправимо до 12:00»). Працює з крону кожні 2 хвилини.
 * Потрібен окремий ключ SalesDrive з правом змінювати заявки: SALESDRIVE_ORDERS_WRITE_KEY (лише у Vercel).
 */
import { getSetting, setSetting } from "./util";
import { fetchOrdersByStatusLive } from "./orders";

export type AfterHoursCfg = {
  enabled: boolean;
  fromStatusId: number | null; // «Новий»
  toStatusId: number | null; // «Новий СМС»
  weekdayEnd: string; // Пн–Пт: після цього часу — неробочий (за замовчуванням 17:30)
  weekendEnd: string; // Сб–Нд (16:00)
  start: string; // з цього часу робочий день (10:00)
};

export const DEFAULT_CFG: AfterHoursCfg = { enabled: false, fromStatusId: null, toStatusId: null, weekdayEnd: "17:30", weekendEnd: "16:00", start: "10:00" };

export async function afterHoursCfg(): Promise<AfterHoursCfg> {
  try {
    return { ...DEFAULT_CFG, ...(JSON.parse((await getSetting("afterHoursCfg")) ?? "{}") as Partial<AfterHoursCfg>) };
  } catch {
    return DEFAULT_CFG;
  }
}

export const writeKeyConfigured = () => Boolean(process.env.SALESDRIVE_URL && process.env.SALESDRIVE_ORDERS_WRITE_KEY);

const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Київський час з «2026-11-22 21:30:00» (так SalesDrive віддає orderTime) або з Date */
function kyivParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return { day: get("weekday"), min: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Чи час (київський) неробочий: після кінця дня або до початку. Для ночі важить день, коли закінчився попередній робочий день. */
export function isAfterHours(cfg: AfterHoursCfg, day: string, min: number) {
  const weekend = day === "Sat" || day === "Sun";
  const end = mins(weekend ? cfg.weekendEnd : cfg.weekdayEnd);
  return min >= end || min < mins(cfg.start);
}

function orderKyiv(orderTime: string): { day: string; min: number } | null {
  // SalesDrive дає локальний (київський) час без зони
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(orderTime);
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)); // полудень — щоб день тижня не з’їхав
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(date);
  return { day, min: Number(m[4]) * 60 + Number(m[5]) };
}

async function sdUpdateStatus(id: number, statusId: number) {
  const url = process.env.SALESDRIVE_URL!.replace(/\/+$/, "");
  const res = await fetch(`${url}/api/order/update/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": process.env.SALESDRIVE_ORDERS_WRITE_KEY! },
    body: JSON.stringify({ id, data: { statusId } }),
    cache: "no-store",
  });
  const text = await res.text();
  let ok = res.ok;
  try {
    const j = JSON.parse(text) as { status?: string; success?: boolean };
    if (j.status === "error" || j.success === false) ok = false;
  } catch {
    /* не JSON — дивимось лише на код */
  }
  return { ok, status: res.status, text: text.slice(0, 300) };
}

export type AfterHoursLog = { at: string; id: number; ok: boolean; info: string };

/** dryRun — лише показати, які заявки змінились би */
export async function runAfterHours(dryRun = false): Promise<{ checked: number; changed: AfterHoursLog[]; skipped?: string }> {
  const cfg = await afterHoursCfg();
  if (!dryRun && !cfg.enabled) return { checked: 0, changed: [], skipped: "вимкнено" };
  if (!cfg.fromStatusId || !cfg.toStatusId) return { checked: 0, changed: [], skipped: "не вибрано статуси" };
  if (!dryRun && !writeKeyConfigured()) return { checked: 0, changed: [], skipped: "немає SALESDRIVE_ORDERS_WRITE_KEY" };
  const orders = await fetchOrdersByStatusLive([cfg.fromStatusId]);
  const out: AfterHoursLog[] = [];
  for (const o of orders) {
    const id = Number(o.id);
    const t = orderKyiv(String(o.orderTime ?? ""));
    if (!id || !t || !isAfterHours(cfg, t.day, t.min)) continue;
    // лише свіжі (до 18 год) — старі «Нові» менеджер опрацьовує сам
    const age = Date.now() - new Date(String(o.orderTime).replace(" ", "T") + "+02:00").getTime();
    if (age > 18 * 3600_000) continue;
    if (dryRun) {
      out.push({ at: new Date().toISOString(), id, ok: true, info: `змінилась би (заявка ${String(o.orderTime).slice(0, 16)})` });
      continue;
    }
    const r = await sdUpdateStatus(id, cfg.toStatusId);
    out.push({ at: new Date().toISOString(), id, ok: r.ok, info: r.ok ? "статус змінено" : `SalesDrive ${r.status}: ${r.text}` });
  }
  if (!dryRun && out.length) {
    let log: AfterHoursLog[] = [];
    try {
      log = JSON.parse((await getSetting("afterHoursLog")) ?? "[]");
    } catch {}
    await setSetting("afterHoursLog", JSON.stringify([...out, ...log].slice(0, 30)));
  }
  return { checked: orders.length, changed: out };
}

/** Чи зараз неробочий час (щоб крон не смикав SalesDrive вдень) */
export async function nowAfterHours() {
  const cfg = await afterHoursCfg();
  const k = kyivParts(new Date());
  return isAfterHours(cfg, k.day, k.min);
}
