import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { codeOwner } from "@/lib/codes";
import { barcodeProblem, skuProblem } from "@/lib/validate";

// Жива перевірка коду у формі: чи не зайнятий він іншим товаром і чи правильний формат
export async function GET(req: Request) {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const code = (sp.get("code") ?? "").slice(0, 100);
  const kind = sp.get("kind") === "sku" ? "sku" : "barcode";
  const except = Number(sp.get("except")) || undefined;
  if (!code.trim()) return NextResponse.json({ ok: true });
  const problem = kind === "sku" ? skuProblem(code) : barcodeProblem(code);
  const owner = await codeOwner(code.trim(), except);
  return NextResponse.json({
    ok: !problem && !owner,
    problem,
    owner: owner ? { id: owner.id, name: owner.name } : null,
  });
}
