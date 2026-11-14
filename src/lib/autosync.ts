import { db } from "./db";
import { syncFromYml } from "./sync";
import { ordersEnabled, syncOrders } from "./orders";
import { getSetting, logAction, setSetting } from "./util";

const INTERVAL_MS = 15 * 60 * 1000; // як часто оновлюємо дані з SalesDrive під час роботи
const LOCK_MS = 5 * 60 * 1000;

/**
 * Фонова синхронізація: викликається після відкриття сторінок (через after()).
 * Якщо з останньої синхронізації минуло більше 15 хвилин — оновлює товари, залишки й продажі.
 * Замок у базі не дає двом синхронізаціям запуститися одночасно.
 */
export async function maybeAutoSync() {
  if (!process.env.SALESDRIVE_YML_URL) return;
  const lastRaw = await getSetting("lastSync");
  const last = lastRaw ? new Date(JSON.parse(lastRaw).at).getTime() : 0;
  if (Date.now() - last < INTERVAL_MS) return;

  // Атомарно беремо замок: оновлюємо запис, лише якщо він вільний або протермінований
  const lockUntil = Date.now() + LOCK_MS;
  const taken = await db.setting.updateMany({
    where: { key: "syncLock", value: { lt: String(Date.now()).padStart(15, "0") } },
    data: { value: String(lockUntil).padStart(15, "0") },
  });
  if (taken.count === 0) {
    const exists = await db.setting.findUnique({ where: { key: "syncLock" } });
    if (exists) return; // хтось уже синхронізує
    try {
      await db.setting.create({ data: { key: "syncLock", value: String(lockUntil).padStart(15, "0") } });
    } catch {
      return;
    }
  }

  try {
    const r = await syncFromYml();
    const orders = ordersEnabled() ? await syncOrders() : null;
    await logAction(null, "auto-sync", "products", null, { ...r, orders });
  } catch (e) {
    await setSetting("syncWarning", `Автосинхронізація: ${e instanceof Error ? e.message : e}`);
  } finally {
    await setSetting("syncLock", "0".padStart(15, "0"));
  }
}
