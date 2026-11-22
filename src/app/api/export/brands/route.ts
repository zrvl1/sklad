import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Файл брендів для імпорту в Horoshop (SalesDrive не передає «Виробника» в бренд Horoshop).
 * Колонки: Артикул (ID SalesDrive — так товари звʼязані в Horoshop), Артикул для відображення (SKU), Бренд, Назва.
 */
export async function GET() {
  const user = await getUser();
  if (!user || user.role !== "admin") return new Response("forbidden", { status: 403 });
  const rows = await db.product.findMany({
    where: { deletedAt: null, sdId: { not: null }, manufacturer: { not: null } },
    select: { sdId: true, sku: true, manufacturer: true, name: true, nameTranslate: true },
    orderBy: { sku: "asc" },
  });
  const q = (v: string | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Артикул", "Артикул для відображення на сайті", "Бренд", "Назва"].map(q).join(";"),
    ...rows.filter((r) => r.manufacturer!.trim()).map((r) => [r.sdId, r.sku, r.manufacturer!.trim(), r.nameTranslate || r.name].map(q).join(";")),
  ];
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="horoshop-brands.csv"' },
  });
}
