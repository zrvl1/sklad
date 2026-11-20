import crypto from "node:crypto";
import { promConfigured, promStockSync } from "@/lib/prom";
import { getSetting } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Кожні 5 хвилин (vercel.json): наявність SalesDrive → Prom, лише зміни. Увімкнення — у Налаштуваннях.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || secret.length < 16 || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!promConfigured() || (await getSetting("promEnabled")) !== "1") return Response.json({ ok: true, skipped: true });
  try {
    const r = await promStockSync();
    if ((await getSetting("promKwAuto")) === "1") {
      try {
        await (await import("@/lib/prom")).promPushUaKeywords({ limit: 30 });
      } catch {
        /* не заважає наявності */
      }
    }
    return Response.json({ ok: true, ...r, sample: undefined, unmatchedSample: undefined });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
