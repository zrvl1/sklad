import crypto from "node:crypto";
import { syncFromYml } from "@/lib/sync";
import { db } from "@/lib/db";
import { ordersEnabled, syncOrders } from "@/lib/orders";
import { logAction } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Автоматична синхронізація з SalesDrive за розкладом (vercel.json → crons).
 * Доступ лише з секретом CRON_SECRET у заголовку Authorization — Vercel додає його сам.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || secret.length < 16 || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("unauthorized", { status: 401 });
  }
  try {
    const r = await syncFromYml();
    // знімок вартості складу на початок місяця (крон о 7:00 — 1-го числа це і є початок)
    await (await import("@/lib/finance")).ensureStockSnapshot();
    // прибираємо старі записи спроб входу (старші за 90 днів)
    await db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 864e5) } } });
    const orders = ordersEnabled() ? await syncOrders() : null; // продажі для звітів
    await logAction(null, "auto-sync", "products", null, { ...r, orders });
    return Response.json({ ok: true, ...r, orders });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await logAction(null, "auto-sync-error", "products", null, error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
