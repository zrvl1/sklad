import { ua } from "@/lib/names";
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { searchProducts } from "@/lib/codes";
import { mainImage } from "@/lib/images";
import { promCommissions } from "@/lib/commission";

// Пошук товару для сканера: штрихкод, артикул, артикул постачальника, ID, або частина назви.
// ?wh=ID — додати залишок товару на цьому складі (для інвентаризації).
export async function GET(req: Request) {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  if (!q) return NextResponse.json([]);
  // у документах (прихід, інвентаризація, списання) картки-комплекти завжди замінюються основним товаром
  // у вікнах документів показуємо українську назву
  const found = (await searchProducts(q, 20, true)).map((f) => ({ ...f, name: ua(f) }));
  if (!found.length) return NextResponse.json(found);
  // маленьке фото і загальний залишок (по всіх складах) — для приходу
  const ids = found.map((f) => f.id);
  const [imgs, totals] = await Promise.all([
    db.product.findMany({ where: { id: { in: ids } }, select: { id: true, images: true } }),
    db.stockBalance.groupBy({ by: ["productId"], where: { productId: { in: ids } }, _sum: { qty: true } }),
  ]);
  const imgMap = new Map(imgs.map((p) => [p.id, mainImage(p.images)]));
  const totMap = new Map(totals.map((t) => [t.productId, t._sum.qty ?? 0]));
  const { byProduct } = await promCommissions(ids);
  const enriched = found.map((f) => {
    const c = byProduct.get(f.id);
    return { ...f, image: imgMap.get(f.id) ?? null, stockTotal: totMap.get(f.id) ?? 0, promPct: c ? c.pct : null, promCat: c?.catName ?? null };
  });
  const wh = Number(params.get("wh"));
  if (!wh) return NextResponse.json(enriched);
  const stocks = await db.stockBalance.findMany({ where: { warehouseId: wh, productId: { in: found.map((f) => f.id) } } });
  const map = new Map<number, number>(stocks.map((s) => [s.productId, s.qty]));
  return NextResponse.json(enriched.map((f) => ({ ...f, stock: map.get(f.id) ?? 0 })));
}
