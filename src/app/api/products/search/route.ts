import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { searchProducts } from "@/lib/codes";

// Пошук товару для сканера: штрихкод, артикул, артикул постачальника, ID, або частина назви.
// ?wh=ID — додати залишок товару на цьому складі (для інвентаризації).
export async function GET(req: Request) {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  if (!q) return NextResponse.json([]);
  // у документах (прихід, інвентаризація, списання) картки-комплекти завжди замінюються основним товаром
  const found = await searchProducts(q, 20, true);
  const wh = Number(params.get("wh"));
  if (!wh || !found.length) return NextResponse.json(found);
  const stocks = await db.stockBalance.findMany({ where: { warehouseId: wh, productId: { in: found.map((f) => f.id) } } });
  const map = new Map<number, number>(stocks.map((s) => [s.productId, s.qty]));
  return NextResponse.json(found.map((f) => ({ ...f, stock: map.get(f.id) ?? 0 })));
}
