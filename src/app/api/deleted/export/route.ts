import { db } from "@/lib/db";
import { can, getUser } from "@/lib/auth";

// CSV зі списком товарів, які треба прибрати на конкретному сайті (відкривається в Excel)
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  if (!can(user, "products.edit")) return new Response("forbidden", { status: 403 });
  const site = (new URL(req.url).searchParams.get("site") ?? "").slice(0, 50);
  const rows = await db.deletedProductSite.findMany({
    where: { site, status: "todo" },
    include: { deleted: true },
    orderBy: { deleted: { deletedAt: "asc" } },
  });
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["Видалено", "ID SalesDrive", "Артикул", "Штрихкод", "Назва", "Категорія", "Ціна", "Звідки", "Причина"]];
  for (const r of rows) {
    const d = r.deleted;
    lines.push([
      d.deletedAt.toLocaleDateString("uk-UA"),
      d.sdId ?? "",
      d.sku ?? "",
      d.barcode ?? "",
      d.name,
      d.categoryName ?? "",
      String(d.price).replace(".", ","),
      d.source === "crm" ? "SalesDrive" : "додаток",
      d.reason ?? "",
    ]);
  }
  const csv = "﻿" + lines.map((l) => l.map(esc).join(";")).join("\r\n");
  const name = `vydalyty_${site.replace(/[^\w-]/g, "") || "site"}_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
}
