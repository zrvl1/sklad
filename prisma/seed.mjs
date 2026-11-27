// Створює першого користувача (адміністратора) і склад "Основний".
// Запуск: npm run db:seed
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const db = new PrismaClient();

function hashPassword(p) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(p, salt, 64).toString("hex");
  return `${salt}:${h}`;
}

const login = process.env.ADMIN_LOGIN || "admin";
const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 10) {
  console.error("Вкажіть ADMIN_PASSWORD (10+ символів) у файлі .env");
  process.exit(1);
}

await db.user.upsert({
  where: { login },
  update: {},
  create: {
    login,
    name: process.env.ADMIN_NAME || "Адміністратор",
    passwordHash: hashPassword(password),
    role: "admin",
  },
});

if ((await db.warehouse.count()) === 0) {
  await db.warehouse.create({ data: { name: "Основний", isDefault: true } });
}

// одноразово: товари постачальників, які вже перейменовували, — у список «назви для Хорошопу»
if (!(await db.setting.findUnique({ where: { key: "backfill:nameChangedAt" } }))) {
  await db.product.updateMany({
    where: { deletedAt: null, supplierId: { not: null }, syncedAt: { not: null }, nameChangedAt: null },
    data: { nameChangedAt: new Date() },
  });
  await db.setting.create({ data: { key: "backfill:nameChangedAt", value: new Date().toISOString() } });
}

console.log(`Готово. Вхід: ${login}`);
await db.$disconnect();
