import { db } from "@/lib/db";
import { can, getUser } from "@/lib/auth";
import { receiptFilter, type ReceiptFilter } from "@/lib/receipts";

// Експорт приходів у CSV (відкривається в Excel: роздільник ";" і BOM для кирилиці)
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  if (!can(user, "receipts")) return new Response("forbidden", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams) as ReceiptFilter;
  const receipts = await db.receipt.findMany({
    where: receiptFilter(sp),
    include: { supplier: true, warehouse: true, lines: { include: { product: true, cell: true } } },
    orderBy: { date: "asc" },
  });

  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const dec = (v: number) => String(Math.round(v * 100) / 100).replace(".", ",");

  const rows = [
    ["Дата", "Номер", "Статус", "Склад", "Постачальник", "Накладна", "ID товару", "Товар", "SKU", "Штрихкод", "Комірка", "К-сть", "Валюта", "Курс", "Закупівля у валюті", "Закупівля, грн", "Сума, грн", "Нова ціна, грн"],
  ];
  for (const r of receipts) {
    for (const l of r.lines) {
      rows.push([
        r.date.toLocaleDateString("uk-UA"),
        r.number,
        r.status === "posted" ? "проведено" : "чернетка",
        r.warehouse.name,
        r.supplier?.name ?? "",
        r.invoiceNo ?? "",
        l.product.sdId ?? "",
        l.product.name,
        l.product.sku ?? "",
        l.product.barcode ?? "",
        l.cell?.code ?? "",
        dec(l.qty),
        r.currency,
        dec(r.rate),
        dec(l.cost),
        dec(l.cost * r.rate),
        dec(l.qty * l.cost * r.rate),
        l.newPrice ? dec(l.newPrice) : "",
      ]);
    }
  }
  const csv = "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n");
  const name = `prykhid_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
  });
}
