import crypto from "node:crypto";

/**
 * Доступ до Google API через сервісний акаунт (лише читання).
 * Змінні Vercel: GOOGLE_SA_JSON — вміст JSON-ключа; GA4_PROPERTY_ID — номер ресурсу GA4;
 * GSC_SITE — ресурс Search Console (за замовчуванням https://crane-moto.com/).
 */
type SA = { client_email: string; private_key: string };

function sa(): SA | null {
  const raw = process.env.GOOGLE_SA_JSON || process.env.GA4_CREDENTIALS;
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as SA;
    return j.client_email && j.private_key ? j : null;
  } catch {
    return null;
  }
}

export function googleConfigured() {
  return Boolean(sa());
}
export function ga4Configured() {
  return Boolean(sa() && process.env.GA4_PROPERTY_ID);
}
export function saEmail() {
  return sa()?.client_email ?? null;
}

const tokenCache = new Map<string, { token: string; exp: number }>();

async function accessToken(scope: string) {
  const cached = tokenCache.get(scope);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const key = sa();
  if (!key) throw new Error("Немає GOOGLE_SA_JSON у Vercel");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "RS256", typ: "JWT" });
  const claim = b64({ iss: key.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${claim}`).sign(key.private_key.replace(/\\n/g, "\n"), "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google: ${j.error_description || j.error || res.status}`);
  tokenCache.set(scope, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

async function gpost<T>(url: string, scope: string, body: unknown): Promise<T> {
  const token = await accessToken(scope);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {}
    throw new Error(`Google ${res.status}: ${msg}`);
  }
  return JSON.parse(text) as T;
}

export type Row = Record<string, string | number>;

/** GA4 Data API: рядки звіту як обʼєкти {вимір: значення, метрика: число} */
export async function ga4(body: {
  dimensions?: string[];
  metrics: string[];
  days?: number;
  offsetDays?: number;
  filter?: object;
  orderBy?: string;
  limit?: number;
  ukraineOnly?: boolean;
}): Promise<Row[]> {
  const days = body.days ?? 28;
  const off = body.offsetDays ?? 0;
  const filters: object[] = [];
  if (body.ukraineOnly !== false) filters.push({ filter: { fieldName: "country", stringFilter: { value: "Ukraine" } } });
  if (body.filter) filters.push(body.filter);
  const req = {
    dateRanges: [{ startDate: `${days + off}daysAgo`, endDate: off ? `${off + 1}daysAgo` : "today" }],
    dimensions: (body.dimensions ?? []).map((name) => ({ name })),
    metrics: body.metrics.map((name) => ({ name })),
    ...(filters.length ? { dimensionFilter: filters.length === 1 ? filters[0] : { andGroup: { expressions: filters } } } : {}),
    ...(body.orderBy ? { orderBys: [{ metric: { metricName: body.orderBy }, desc: true }] } : {}),
    limit: body.limit ?? 50,
  };
  const r = await gpost<{ rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] }>(
    `https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GA4_PROPERTY_ID}:runReport`,
    "https://www.googleapis.com/auth/analytics.readonly",
    req
  );
  return (r.rows ?? []).map((row) => {
    const o: Row = {};
    (body.dimensions ?? []).forEach((d, i) => (o[d] = row.dimensionValues?.[i]?.value ?? ""));
    body.metrics.forEach((m, i) => (o[m] = Number(row.metricValues?.[i]?.value ?? 0)));
    return o;
  });
}

/** Search Console: пошукові запити / сторінки за період (дані з затримкою 2–3 дні) */
export async function gsc(dimension: "query" | "page", days = 28, limit = 200) {
  const site = process.env.GSC_SITE || "https://crane-moto.com/";
  const d = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  const r = await gpost<{ rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }>(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    "https://www.googleapis.com/auth/webmasters.readonly",
    { startDate: d(days + 3), endDate: d(3), dimensions: [dimension], rowLimit: limit }
  );
  return (r.rows ?? []).map((x) => ({ key: x.keys[0], clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position }));
}
