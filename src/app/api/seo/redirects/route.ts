import { getUser } from "@/lib/auth";
import { getSetting } from "@/lib/util";
import type { Redirect } from "@/lib/redirects";

export const dynamic = "force-dynamic";

/** CSV редиректів: стара адреса → нова (відносні шляхи, як приймає Horoshop) */
export async function GET(req: Request) {
  const full = new URL(req.url).searchParams.get("full") === "1";
  const abs = (p: string) => (full ? `https://crane-moto.com${p}` : p);
  const user = await getUser();
  if (!user || user.role !== "admin") return new Response("forbidden", { status: 403 });
  let list: Redirect[] = [];
  try {
    list = JSON.parse((await getSetting("redirects404")) ?? "[]");
  } catch {}
  const fmt = new URL(req.url).searchParams.get("fmt") ?? "xlsx";
  const rows = list.map((r) => [abs(r.from), abs(r.to)]);
  if (fmt === "xlsx") {
    const { writeXlsx } = await import("@/lib/xlsxWrite");
    // без заголовка: дві колонки — стара адреса, нова адреса
    return new Response(new Uint8Array(writeXlsx(rows, "Редиректи")), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="redirects-301${full ? "-full" : ""}.xlsx"`,
      },
    });
  }
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  // CSV через кому, без заголовка
  const body = rows.map(([a, b]) => `${q(a)},${q(b)}`).join("\r\n");
  return new Response("﻿" + body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="redirects-301.csv"' } });
}
