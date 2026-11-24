"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { createCategory, deleteCategory, updateCategory } from "@/lib/categories";
import { logAction, str } from "@/lib/util";

const back = (msg: string) => {
  revalidatePath("/categories");
  revalidatePath("/products/new");
  redirect(`/categories?msg=${encodeURIComponent(msg)}`);
};

export async function addCategory(formData: FormData) {
  const user = await requirePerm("products.edit");
  const name = str(formData.get("name"));
  if (!name) return back("Вкажіть назву категорії");
  let msg: string;
  try {
    const c = await createCategory(name, str(formData.get("parentId")));
    await logAction(user.id, "create", "category", null, { id: c.id, name: c.name });
    msg = `Створено в SalesDrive: ${c.path}`;
  } catch (e) {
    msg = `Не створено: ${e instanceof Error ? e.message : e}`;
  }
  back(msg);
}

export async function editCategory(formData: FormData) {
  const user = await requirePerm("products.edit");
  const id = str(formData.get("id"));
  const name = str(formData.get("name"));
  const parentId = str(formData.get("parentId"));
  if (!id || !name) return back("Вкажіть назву");
  if (parentId === id) return back("Категорія не може бути всередині самої себе");
  let msg: string;
  try {
    await updateCategory(id, name, parentId);
    await logAction(user.id, "update", "category", null, { id, name, parentId });
    msg = `Збережено: ${name}`;
  } catch (e) {
    msg = `Не збережено: ${e instanceof Error ? e.message : e}`;
  }
  back(msg);
}

export async function removeCategory(formData: FormData) {
  const user = await requirePerm("products.edit");
  const id = str(formData.get("id"));
  if (!id) return back("Не вказано категорію");
  let msg: string;
  try {
    const r = await deleteCategory(id, str(formData.get("targetId")));
    await logAction(user.id, "delete", "category", null, { id, ...r });
    msg =
      `Категорію «${r.name}» видалено.` +
      (r.moved ? ` Товарів перенесено: ${r.moved} → ${r.target}.` : "") +
      (r.children ? ` Підкатегорій піднято на рівень вище: ${r.children}.` : "") +
      r.sdNote;
  } catch (e) {
    msg = `Не видалено: ${e instanceof Error ? e.message : e}`;
  }
  back(msg);
}
