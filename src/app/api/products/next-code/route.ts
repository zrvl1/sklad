import { NextResponse } from "next/server";
import { can, getUser } from "@/lib/auth";
import { nextBarcode, nextSku } from "@/lib/nextcodes";

// Кнопки «Створити штрихкод» / «Наступний артикул» у формі товару
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || !can(user, "products.edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const kind = new URL(req.url).searchParams.get("kind");
  return NextResponse.json({ code: kind === "sku" ? await nextSku() : await nextBarcode() });
}
