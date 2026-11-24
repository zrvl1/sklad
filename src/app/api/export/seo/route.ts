import { getUser, can } from "@/lib/auth";
import { seoRows, seoWhere, type SeoScope } from "@/lib/seoFile";

/** XLSX для дописування SEO-текстів: ?scope=new|feed|category&cat=ID або ?ids=1,2,3 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || !can(user, "products.edit")) return new Response("unauthorized", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const ids = (sp.get("ids") ?? "")
    .split(/[\s,;]+/)
    .map(Number)
    .filter((n) => n > 0);
  const scope = (ids.length ? "ids" : (sp.get("scope") ?? "new")) as SeoScope;
  const { rows, count } = await seoRows(seoWhere(scope, { categoryId: sp.get("cat") ?? undefined, ids }), Math.min(500, Number(sp.get("limit")) || 100));
  const { writeXlsx } = await import("@/lib/xlsxWrite");
  const date = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(writeXlsx(rows, "SEO")), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="seo-${scope}-${count}-${date}.xlsx"`,
    },
  });
}
