import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Аудит каталогу для SEO/органіки: компактний JSON по кожному товару (лише читання, адмін). ?offset=&limit= */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || user.role !== "admin") return new Response("forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const offset = Number(sp.get("offset") ?? 0) || 0;
  const limit = Math.min(Number(sp.get("limit") ?? 600) || 600, 1000);
  const ps = await db.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true, sdId: true, sku: true, name: true, nameTranslate: true, categoryName: true, manufacturer: true, country: true,
      price: true, cost: true, description: true, descriptionTranslate: true, keywords: true, keywordsUa: true, params: true,
      images: true, baseProductId: true, stocks: { select: { qty: true } },
    },
    orderBy: { id: "asc" },
    skip: offset,
    take: limit,
  });
  const txt = (h: string | null) => (h ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const cnt = (s: string | null) => (s ?? "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).length;
  const arr = (s: string | null) => {
    try {
      const v = JSON.parse(s ?? "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  return Response.json(
    ps.map((p) => {
      const d = txt(p.description), dt = txt(p.descriptionTranslate);
      return {
        id: p.id, sd: p.sdId, sku: p.sku, kit: p.baseProductId ? 1 : 0,
        n: p.name, nt: p.nameTranslate, cat: p.categoryName, br: p.manufacturer, co: p.country,
        pr: p.price, cost: p.cost, st: p.stocks.reduce((s, x) => s + Number(x.qty), 0),
        dl: d.length, dtl: dt.length, d0: d.slice(0, 160), kw: cnt(p.keywords), kwu: cnt(p.keywordsUa),
        pa: arr(p.params).length, img: arr(p.images).length,
      };
    })
  );
}
