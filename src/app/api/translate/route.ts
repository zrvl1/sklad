import { NextResponse } from "next/server";
import { can, getUser } from "@/lib/auth";
import { translate, translateConfigured } from "@/lib/translate";
import { translateKeywords } from "@/lib/ruua";

// Кнопки «перекласти» у формі товару: { texts: string[], from: "RU"|"UK", to: "RU"|"UK", html?: boolean, keywords?: boolean }
export async function POST(req: Request) {
  const user = await getUser();
  if (!user || !can(user, "products.edit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { texts?: string[]; from?: string; to?: string; html?: boolean; keywords?: boolean } | null;
  const texts = (b?.texts ?? []).map((t) => String(t ?? "").slice(0, 20000)).slice(0, 10);
  const from = b?.from === "UK" ? "UK" : "RU";
  const to = b?.to === "RU" ? "RU" : "UK";
  if (!translateConfigured()) {
    // без DeepL — лише ключові слова RU → UA за словником
    if (b?.keywords && from === "RU") return NextResponse.json({ texts: texts.map(translateKeywords), fallback: true });
    return NextResponse.json({ error: "Перекладач не підключено: додайте DEEPL_API_KEY у Vercel" }, { status: 400 });
  }
  try {
    return NextResponse.json({ texts: await translate(texts, from, to, Boolean(b?.html)) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
