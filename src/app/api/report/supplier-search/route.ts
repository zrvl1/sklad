import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Пошук у фідах постачальників за словами (для підбору асортименту). Лише читання, адмін.
 * ?q=ремінь b-950;стартер 186f — кілька запитів через «;», усередині запиту всі слова мають бути в назві/артикулі/категорії.
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || user.role !== "admin") return new Response("forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const qs = (sp.get("q") ?? "").split(";").map((s) => s.trim()).filter(Boolean).slice(0, 40);
  const limit = Math.min(Number(sp.get("limit") ?? 25) || 25, 100);
  const linked = new Set(
    (await db.product.findMany({ where: { deletedAt: null, supplierCode: { not: null } }, select: { supplierCode: true } })).map((p) => p.supplierCode!)
  );
  const out: Record<string, unknown[]> = {};
  for (const q of qs) {
    const words = q.split(/\s+/).filter(Boolean);
    const items = await db.supplierItem.findMany({
      where: {
        AND: words.map((w) => ({
          OR: [
            { name: { contains: w, mode: "insensitive" as const } },
            { article: { contains: w, mode: "insensitive" as const } },
            { category: { contains: w, mode: "insensitive" as const } },
          ],
        })),
      },
      select: { code: true, article: true, name: true, price: true, currency: true, available: true, category: true, brand: true, supplier: { select: { name: true } } },
      orderBy: [{ available: "desc" }, { price: "asc" }],
      take: limit,
    });
    out[q] = items.map((i) => ({ s: i.supplier.name, code: i.code, art: i.article, n: i.name, p: i.price, cur: i.currency, av: i.available ? 1 : 0, cat: i.category, br: i.brand, have: linked.has(i.code) ? 1 : 0 }));
  }
  return Response.json(out);
}
