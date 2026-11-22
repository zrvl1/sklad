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
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const body = ["Звідки;Куди", ...list.map((r) => `${q(abs(r.from))};${q(abs(r.to))}`)].join("\r\n");
  return new Response("﻿" + body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="redirects-301.csv"' } });
}
