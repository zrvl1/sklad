import crypto from "node:crypto";
import { getSetting } from "@/lib/util";
import { labelRows } from "@/lib/merchantLabels";

export const dynamic = "force-dynamic";

/**
 * Додатковий фід для Google Merchant Center (TSV): id, brand, custom_label_0 (маржа), custom_label_1 (залишок), custom_label_2 (ціна).
 * Доступ за секретним ключем у посиланні.
 */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const expected = (await getSetting("merchantFeedKey")) ?? "";
  if (expected.length < 20 || key.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected))) {
    return new Response("forbidden", { status: 403 });
  }
  const rows = await labelRows();
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();
  const body = [
    "id\tbrand\tcustom_label_0\tcustom_label_1\tcustom_label_2",
    ...rows.map((r) => [r.id, r.brand, r.margin, r.stock, r.price].map(clean).join("\t")),
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/tab-separated-values; charset=utf-8" } });
}
