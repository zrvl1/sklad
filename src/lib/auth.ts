import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { db } from "./db";

const COOKIE = "sklad_session";
const MAX_AGE_DAYS = 14;
export const MIN_PASSWORD = 10;

// Захист від підбору пароля: за 15 хвилин не більше 5 невдалих спроб на логін і 20 з однієї IP-адреси
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_LOGIN = 5;
const MAX_FAILS_PER_IP = 20;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("Вкажіть SESSION_SECRET (16+ символів) у .env");
  return s;
}

function sign(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${h}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, h] = stored.split(":");
  if (!salt || !h) return false;
  const calc = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(h, "hex");
  return calc.length === expected.length && crypto.timingSafeEqual(calc, expected);
}

// Хеш-заглушка: перевіряємо пароль навіть для неіснуючого логіна, щоб за часом відповіді не можна було вгадати логіни
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString("hex"));

export function checkPassword(password: string, stored: string | null | undefined) {
  return verifyPassword(password, stored ?? DUMMY_HASH) && Boolean(stored);
}

export async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

export async function isLoginBlocked(login: string, ip: string) {
  const since = new Date(Date.now() - LOCK_WINDOW_MS);
  const [byLogin, byIp] = await Promise.all([
    db.loginAttempt.count({ where: { login, ok: false, createdAt: { gte: since } } }),
    db.loginAttempt.count({ where: { ip, ok: false, createdAt: { gte: since } } }),
  ]);
  return byLogin >= MAX_FAILS_PER_LOGIN || byIp >= MAX_FAILS_PER_IP;
}

// Cookie лише по HTTPS на сервері; локально (npm run dev) — без цього, бо там http
const SECURE_COOKIE = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";

export async function createSession(userId: number) {
  const iat = Date.now();
  const exp = iat + MAX_AGE_DAYS * 864e5;
  const value = `${userId}.${iat}.${exp}`;
  (await cookies()).set(COOKIE, `${value}.${sign(value)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE_COOKIE,
    path: "/",
    maxAge: MAX_AGE_DAYS * 86400,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function getUser() {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [id, iat, exp, sig] = raw.split(".");
  if (!id || !iat || !exp || !sig) return null;
  const expected = sign(`${id}.${iat}.${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  const user = await db.user.findUnique({ where: { id: Number(id) } });
  if (!user?.active) return null;
  // після зміни пароля всі сесії, видані раніше, стають недійсними
  if (Number(iat) < user.passwordChangedAt.getTime() - 1000) return null;
  return user;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}
