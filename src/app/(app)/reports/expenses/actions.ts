"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { logAction, num, str } from "@/lib/util";

const back = (q: string) => {
  revalidatePath("/reports/expenses");
  revalidatePath("/reports/sales");
  redirect(`/reports/expenses?${q}`);
};

/** Витрата за період: реклама, комісії, доставка тощо. Дата — день, до якого місяця вона відноситься */
export async function addExpense(formData: FormData) {
  const user = await requirePerm("reports");
  const category = str(formData.get("category"));
  const amount = num(formData.get("amount"));
  const date = str(formData.get("date"));
  if (!category || !date || !(amount > 0) || amount > 10_000_000) back(`err=${encodeURIComponent("Вкажіть дату, статтю і суму більше 0")}`);
  const e = await db.expense.create({
    data: { category: category!, amount: Math.round(amount * 100) / 100, date: new Date(`${date}T12:00:00`), note: str(formData.get("note")), createdById: user.id },
  });
  await logAction(user.id, "create", "expense", e.id, { category, amount });
  back(`month=${date!.slice(0, 7)}&msg=${encodeURIComponent("Витрату додано")}`);
}

export async function deleteExpense(formData: FormData) {
  const user = await requirePerm("reports");
  const id = Number(formData.get("id"));
  const e = await db.expense.delete({ where: { id } });
  await logAction(user.id, "delete", "expense", id, { category: e.category, amount: e.amount });
  back(`month=${String(formData.get("month") ?? "")}&msg=${encodeURIComponent("Витрату видалено")}`);
}
