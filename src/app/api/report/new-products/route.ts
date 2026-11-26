import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { promCommissions } from "@/lib/commission";

export const dynamic = "force-dynamic";

/** Товари, створені за день (для аналізу цін): ?date=YYYY-MM-DD (Київ), за замовчуванням сьогодні. Лише читання, адмін. */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || user.role !== "admin") return new Response("forbidden", { status: 403 });
  const d = new URL(req.url).searchParams.get("date") ?? new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  const from = new Date(`${d}T00:00:00+02:00`);
  const to = new Date(from.getTime() + 24 * 3600 * 1000);
  const ps = await db.product.findMany({
    where: { createdAt: { gte: from, lt: to }, deletedAt: null, baseProductId: null },
    include: { codes: { select: { code: true, type: true } } },
    orderBy: { id: "asc" },
  });
  const { byProduct } = await promCommissions(ps.map((p) => p.id));
  const items = ps.length
    ? await db.supplierItem.findMany({ where: { code: { in: ps.map((p) => p.supplierCode).filter((c): c is string => Boolean(c)) } }, select: { code: true, article: true, name: true, price: true, currency: true, available: true } })
    : [];
  type It = { code: string; article: string | null; name: string; price: number; currency: string; available: boolean };
  const byCode = new Map<string, It>((items as It[]).map((i) => [i.code, i]));
  return Response.json(
    ps.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.nameTranslate || p.name,
      nameRu: p.name,
      category: p.categoryName,
      price: p.price,
      cost: p.cost,
      priceLocked: p.priceLocked,
      rrp: p.rrp,
      rrpCurrency: p.rrpCurrency,
      supplierCode: p.supplierCode,
      supplierArticle: p.supplierCode ? byCode.get(p.supplierCode)?.article ?? null : null,
      supplierName: p.supplierCode ? byCode.get(p.supplierCode)?.name ?? null : null,
      codes: p.codes.map((c) => c.code),
      prom: byProduct.get(p.id) ?? null,
    }))
  );
}
