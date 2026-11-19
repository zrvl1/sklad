"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { applyKits, loadImport, parseSdExport, saveImport } from "@/lib/sdimport";
import { logAction } from "@/lib/util";

export async function uploadSdExport(formData: FormData) {
  await requirePerm("products.edit");
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) redirect(`/products/import?err=${encodeURIComponent("Оберіть файл .xlsx")}`);
  if (file.size > 9 * 1024 * 1024) redirect(`/products/import?err=${encodeURIComponent("Файл завеликий (до 9 МБ)")}`);
  let msg = "";
  try {
    const rows = parseSdExport(Buffer.from(await file.arrayBuffer()));
    await saveImport(rows);
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  redirect(`/products/import${msg ? `?err=${encodeURIComponent(msg)}` : ""}`);
}

export async function applySdKits() {
  const user = await requirePerm("products.edit");
  const imp = await loadImport();
  if (!imp) redirect("/products/import");
  const r = await applyKits(imp.rows);
  await logAction(user.id, "import-kits", "product", null, r);
  revalidatePath("/products");
  revalidatePath("/products/kits");
  redirect(`/products/kits?msg=${encodeURIComponent(`Комплекти як у SalesDrive: прив'язано/виправлено ${r.linked}, відв'язано ${r.unlinked}`)}`);
}
