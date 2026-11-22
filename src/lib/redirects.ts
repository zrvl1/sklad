/**
 * Підбір 301-редиректів для сторінок 404 (зі звіту Search Console) на поточні сторінки сайту з sitemap.
 * Схожість — за словами в адресі (з нормалізацією «520h-42t» → «52042»), окремо для UA і /ru/.
 */
const SITE = "https://crane-moto.com";

async function fetchText(url: string) {
  const r = await fetch(url, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 sklad-redirects" } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

export async function sitemapPaths(): Promise<string[]> {
  const idx = await fetchText(`${SITE}/sitemap.xml`);
  const locs = (x: string) => [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const out: string[] = [];
  for (const u of locs(idx)) {
    if (/sitemap.*\.xml$/i.test(u)) out.push(...locs(await fetchText(u)));
    else out.push(u);
  }
  return [...new Set(out.map((u) => new URL(u, SITE).pathname))];
}

const STOP = new Set(["ru", "dlia", "dlya", "na", "ta", "i", "z", "v", "do", "dlja"]);
function tokens(path: string) {
  let s = path.toLowerCase().replace(/^\/(ru\/)?/, "").replace(/\/\d+\/?$/, "").replace(/\/$/, "");
  s = s
    .replace(/(\d{3})h?o?-(\d{2,3})[tl]\b/g, "$1$2")
    .replace(/\b(\d{5,6})[tl]\b/g, "$1")
    .replace(/(\d{3})h\b/g, "$1");
  return s.split(/[-/]+/).filter((t) => t && !STOP.has(t));
}
const stem = (t: string) => (/^\d/.test(t) ? t : t.slice(0, 5));

// «розмірні» числа (52042 — ланцюг 520 і 42 зуби, 104l…) мають збігатися точно, інакше це інший товар
const sizeNums = (t: string[]) => t.filter((x) => /^\d{5,6}$/.test(x));

/** null — кандидат точно не підходить (інший тип товару або інший розмір) */
function score(a: string[], b: string[]): number | null {
  if (a.length < 2 || b.length < 2) return null;
  if (stem(a[0]) !== stem(b[0]) || stem(a[1]) !== stem(b[1])) return null;
  const sa = sizeNums(a);
  const sb = new Set(sizeNums(b));
  if (sa.length && !sa.some((x) => sb.has(x))) return null;
  // передня / задня — не плутати
  const side = (t: string[]) => t.find((x) => /^(pered|zadn)/.test(x))?.slice(0, 4) ?? null;
  if (side(a) && side(b) && side(a) !== side(b)) return null;
  const A = new Set(a.map(stem));
  const B = new Set(b.map(stem));
  // має збігтися хоча б одне «модельне» слово (lifan, kpx, shineray…), а не лише тип товару й цифри
  const model = [...A].filter((x) => !/^\d+$/.test(x) && x !== stem(a[0]) && x !== stem(a[1]) && !/^(pered|zadn)/.test(x));
  if (!model.some((x) => B.has(x))) return null;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

export type Redirect = { from: string; to: string; score: number; kind: "товар" | "категорія" | "головна" };

export function matchRedirects(from404: string[], current: string[]): Redirect[] {
  const cur = current.map((p) => ({ p, ru: p.startsWith("/ru/"), t: tokens(p) }));
  // «категорії» — короткі адреси без цифр (розділи каталогу)
  const isCat = (c: { t: string[] }) => c.t.length <= 4 && !c.t.some((x) => /\d/.test(x));
  const out: Redirect[] = [];
  for (const raw of from404) {
    let path: string;
    try {
      path = new URL(raw, SITE).pathname;
    } catch {
      continue;
    }
    if (current.includes(path)) continue; // сторінка вже існує
    const ru = path.startsWith("/ru/");
    const t = tokens(path);
    const pool = cur.filter((c) => c.ru === ru && c.t.length);
    let best = { c: null as (typeof pool)[number] | null, s: -1 };
    for (const c of pool) {
      if (isCat(c)) continue;
      const s = score(t, c.t);
      if (s !== null && s > best.s) best = { c, s };
    }
    if (best.c && best.s >= 0.4) {
      out.push({ from: path, to: best.c.p, score: Math.round(best.s * 100) / 100, kind: "товар" });
      continue;
    }
    // запчастини мотоблоків (TTG, 178F, 186F, 190N…) — у розділ мотоблоків
    if (t.some((x) => /^(ttg|ybx|17[0-9]f|18[0-9]f|190n|180n|\d{3}n)$/.test(x))) {
      const mb = cur.find((c) => c.ru === ru && /zapchastyny-na-motobloky\/?$/.test(c.p));
      if (mb) {
        out.push({ from: path, to: mb.p, score: 1, kind: "категорія" });
        continue;
      }
    }
    // немає схожого товару — на найближчий розділ каталогу
    let cat = { c: null as (typeof pool)[number] | null, s: -1 };
    for (const c of pool.filter(isCat)) {
      const A = new Set(t.map((x) => x.slice(0, 4)));
      const n = c.t.filter((x) => A.has(x.slice(0, 4))).length;
      // більше збігів слів важливіше; при рівності — точніша (коротша) категорія
      const hit = n ? n + n / c.t.length / 10 : 0;
      if (hit > cat.s) cat = { c, s: hit };
    }
    if (cat.c && cat.s > 0) out.push({ from: path, to: cat.c.p, score: Math.min(1, Math.round((cat.s / 3) * 100) / 100), kind: "категорія" });
    else out.push({ from: path, to: ru ? "/ru/" : "/", score: 0, kind: "головна" });
  }
  return out;
}
