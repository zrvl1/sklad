"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getSites } from "@/lib/deleted";
import { logAction, setSetting } from "@/lib/util";

/** Позначити статус товару на конкретному сайті: todo | done | skip */
export async function setSiteStatus(formData: FormData) {
  const user = await requirePerm("products.edit");
  const id = Number(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["todo", "done", "skip"].includes(status)) return;
  await db.deletedProductSite.update({
    where: { id },
    data: { status, doneAt: status === "todo" ? null : new Date(), doneBy: status === "todo" ? null : user.name },
  });
  revalidatePath("/products/deleted");
}

/** Масово: усі «треба видалити» на сайті позначити як видалені (після того, як прибрали їх на сайті) */
export async function markSiteDone(formData: FormData) {
  const user = await requirePerm("products.edit");
  const site = String(formData.get("site"));
  const r = await db.deletedProductSite.updateMany({ where: { site, status: "todo" }, data: { status: "done", doneAt: new Date(), doneBy: user.name } });
  await logAction(user.id, "site-done", "deleted", site, { count: r.count });
  revalidatePath("/products/deleted");
  redirect(`/products/deleted?msg=${encodeURIComponent(`${site}: позначено видаленими ${r.count}`)}`);
}

/** Список сайтів, де треба прибирати видалені товари. Новий сайт додається до вже видалених товарів зі статусом «треба». */
export async function saveSites(formData: FormData) {
  const user = await requirePerm("products.edit");
  const sites = [
    ...new Set(
      String(formData.get("sites") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ].slice(0, 20);
  const before = await getSites();
  await setSetting("sites", JSON.stringify(sites));
  const added = sites.filter((s) => !before.includes(s));
  if (added.length) {
    const all = await db.deletedProduct.findMany({ select: { id: true } });
    for (const site of added)
      await db.deletedProductSite.createMany({ data: all.map((d) => ({ deletedId: d.id, site, status: "todo" })), skipDuplicates: true });
  }
  await logAction(user.id, "sites", "settings", null, sites);
  redirect(`/products/deleted?msg=${encodeURIComponent(`Сайти: ${sites.join(", ")}`)}`);
}
