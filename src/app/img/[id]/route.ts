import { db } from "@/lib/db";

// Фото, завантажене в додаток. Публічне (SalesDrive, Prom, Horoshop забирають його за посиланням); адреса — випадковий id.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const img = /^[a-z0-9]{10,40}$/i.test(id) ? await db.productImage.findUnique({ where: { id } }) : null;
  if (!img) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: { "Content-Type": img.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Robots-Tag": "noindex" },
  });
}
