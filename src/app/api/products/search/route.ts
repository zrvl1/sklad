import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

// Пошук товару для сканера/пошуку в документах. Точний збіг штрихкоду — першим.
export async function GET(req: Request) {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json([]);

  const select = { id: true, name: true, sku: true, barcode: true, price: true, cost: true, sdId: true } as const;
  const exact = await db.product.findMany({ where: { OR: [{ barcode: q }, { sku: q }, { sdId: q }] }, select, take: 5 });
  if (exact.length) return NextResponse.json(exact);

  const found = await db.product.findMany({
    where: { search: { contains: q.toLowerCase() } },
    select,
    orderBy: { name: "asc" },
    take: 20,
  });
  return NextResponse.json(found);
}
