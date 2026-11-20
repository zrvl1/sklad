import crypto from "node:crypto";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * YML для Prom = YML із SalesDrive + українські пошукові запити (<keywords_ua>) з карток додатку.
 * SalesDrive віддає запити лише російською, а API Prom не приймає українських — тому Prom забирає цей фід замість фіду SalesDrive.
 * Доступ лише за секретним ключем у посиланні (у фіді є ціни/собівартість SalesDrive).
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const expected = (await getSetting("promFeedKey")) ?? "";
  if (expected.length < 20 || key.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected))) {
    return new Response("forbidden", { status: 403 });
  }
  const { fetchYmlText } = await import("@/lib/salesdrive");
  let xml: string;
  try {
    xml = await fetchYmlText();
  } catch (e) {
    // краще помилка, ніж порожній фід (Prom тоді не чіпає товари)
    return new Response(`YML SalesDrive недоступний: ${e instanceof Error ? e.message : e}`, { status: 502 });
  }

  const products = await db.product.findMany({
    where: { deletedAt: null, sdId: { not: null } },
    select: { id: true, sdId: true, keywords: true, keywordsUa: true },
  });

  // перекласти відсутні (порціями, щоб фід не чекав довго)
  const need = products.filter((p) => p.keywords?.trim() && !p.keywordsUa?.trim()).slice(0, 100);
  if (need.length) {
    try {
      const { translate, translateConfigured } = await import("@/lib/translate");
      const { translateKeywords } = await import("@/lib/ruua");
      for (let i = 0; i < need.length; i += 50) {
        const chunk = need.slice(i, i + 50);
        let tr = chunk.map((p) => translateKeywords(p.keywords as string));
        if (translateConfigured()) tr = await translate(chunk.map((p) => p.keywords as string), "RU", "UK").catch(() => tr);
        for (const [k, p] of chunk.entries()) {
          const v = tr[k]?.trim();
          if (!v) continue;
          p.keywordsUa = v;
          await db.product.update({ where: { id: p.id }, data: { keywordsUa: v } });
        }
      }
    } catch {
      /* фід віддаємо все одно */
    }
  }

  const ua = new Map<string, string>();
  for (const p of products) if (p.keywordsUa?.trim()) ua.set(p.sdId as string, p.keywordsUa.trim());

  let added = 0;
  const out = xml.replace(/<offer\b[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<\/offer>/g, (offer, id: string) => {
    const kw = ua.get(id);
    if (!kw) return offer;
    added++;
    const tag = `<keywords_ua>${esc(kw)}</keywords_ua>`;
    if (/<keywords_ua>[\s\S]*?<\/keywords_ua>/.test(offer)) return offer.replace(/<keywords_ua>[\s\S]*?<\/keywords_ua>/, tag);
    if (/<\/keywords>/.test(offer)) return offer.replace("</keywords>", `</keywords>${tag}`);
    return offer.replace(/<\/offer>$/, `${tag}</offer>`);
  });

  return new Response(out, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", "X-Keywords-Ua": String(added) },
  });
}
