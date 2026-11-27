import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Назви товарів для імпорту в Horoshop (SalesDrive не перезаписує там назву вже створених товарів).
 * Колонки: Артикул (ID SalesDrive — так товари звʼязані в Horoshop), SKU, Назва UA, Назва RU.
 * ?from=2026-11-01 — лише товари, створені або змінені з цієї дати; ?sku=CM0546,CM0604 — лише ці.
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || user.role !== "admin") return new Response("forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") ? new Date(sp.get("from")!) : null;
  const pending = sp.get("pending") === "1";
  const skus = (sp.get("sku") ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const rows = await db.product.findMany({
    where: {
      deletedAt: null,
      sdId: { not: null },
      baseProductId: null,
      ...(skus.length ? { sku: { in: skus } } : {}),
      ...(pending ? { nameChangedAt: { not: null } } : {}),
      ...(from && !isNaN(+from) ? { updatedAt: { gte: from } } : {}),
    },
    select: { sdId: true, sku: true, name: true, nameTranslate: true },
    orderBy: { sku: "asc" },
  });
  const q = (v: string | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Артикул", "Артикул для відображення на сайті", "Назва (UA)", "Назва (RU)"].map(q).join(";"),
    ...rows.map((r) => [r.sdId, r.sku, r.nameTranslate || r.name, r.name].map(q).join(";")),
  ];
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="horoshop-names.csv"' },
  });
}
