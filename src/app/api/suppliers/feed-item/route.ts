import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allCategories } from "@/lib/categories";
import { getSetting } from "@/lib/util";

/** Пошук товару у фіді постачальника за кодом або артикулом (для приходу: невідомий код → створити з XML) */
export async function GET(req: Request) {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const code = (sp.get("code") ?? "").trim().slice(0, 100);
  const supplierId = Number(sp.get("supplierId")) || null;
  if (!code) return NextResponse.json(null);
  const it = await db.supplierItem.findFirst({
    where: { ...(supplierId ? { supplierId } : {}), OR: [{ code }, { article: { equals: code, mode: "insensitive" } }] },
    include: { supplier: { select: { id: true, name: true } } },
  });
  if (!it) return NextResponse.json(null);
  const cats = await allCategories();
  let map: Record<string, string> = {};
  try {
    map = JSON.parse((await getSetting("feedCategoryMap")) ?? "{}");
  } catch {}
  const same = it.category ? cats.filter((c) => c.name.toLowerCase() === it.category!.toLowerCase()) : [];
  return NextResponse.json({
    supplierId: it.supplierId,
    supplierName: it.supplier.name,
    code: it.code,
    article: it.article,
    name: it.name,
    price: it.price,
    currency: it.currency,
    photos: (JSON.parse(it.pictures ?? "[]") as string[]).length,
    params: (JSON.parse(it.params ?? "[]") as unknown[]).length,
    defaultCategory: (it.category && map[`${it.supplierId}:${it.category}`]) || (same.length === 1 ? same[0].path : ""),
  });
}
