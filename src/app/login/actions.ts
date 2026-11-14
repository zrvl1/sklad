"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { checkPassword, clientIp, createSession, destroySession, isLoginBlocked } from "@/lib/auth";
import { logAction } from "@/lib/util";

export async function login(formData: FormData) {
  const loginName = String(formData.get("login") ?? "").trim().slice(0, 100);
  const password = String(formData.get("password") ?? "").slice(0, 200);
  const ip = await clientIp();

  if (await isLoginBlocked(loginName, ip)) redirect("/login?e=locked");

  const user = loginName ? await db.user.findUnique({ where: { login: loginName } }) : null;
  const ok = checkPassword(password, user?.passwordHash) && Boolean(user?.active);
  await db.loginAttempt.create({ data: { login: loginName, ip, ok } });
  if (!ok || !user) redirect("/login?e=1");

  await createSession(user.id);
  await logAction(user.id, "login", "user", user.id, { ip });
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
