import crypto from "node:crypto";
import { getSetting } from "@/lib/util";
import { labelRows } from "@/lib/merchantLabels";

export const dynamic = "force-dynamic";

/**
 * Додатковий фід для Google Merchant Center (TSV): id, brand, custom_label_0 (маржа), custom_label_1 (залишок), custom_label_2 (ціна),
 * custom_label_3 (напрям: мотоблоки / мото / олива — для окремих груп об'єктів), google_product_category (5613 — «Транспортні засоби та запчастини > Запчастини для моторних транспортних засобів»:
 * без неї Google сам відносить запчастини до сантехніки, велозапчастин тощо) і product_type (наша категорія).
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
    "id\tbrand\tcustom_label_0\tcustom_label_1\tcustom_label_2\tcustom_label_3\tgoogle_product_category\tproduct_type",
    ...rows.map((r) => [r.id, r.brand, r.margin, r.stock, r.price, r.segment, "5613", r.productType].map(clean).join("\t")),
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/tab-separated-values; charset=utf-8" } });
}
