import crypto from "node:crypto";
import { backfillOrders, backfillState } from "@/lib/orders";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Кожні 2 хвилини: якщо йде фонове завантаження заявок — ще одна порція (8 сторінок по 100)
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || secret.length < 16 || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!(await backfillState())) return Response.json({ ok: true, idle: true });
  try {
    return Response.json({ ok: true, ...(await backfillOrders()) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
