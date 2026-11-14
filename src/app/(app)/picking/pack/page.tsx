import Link from "next/link";
import { ordersEnabled } from "@/lib/orders";
import PackStation from "./PackStation";

// Робоче місце пакувальника: скан ТТН → перевірка товарів сканером → «Запаковано»
export default function PackPage() {
  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Пакування</h1>
        <span className="spacer" />
        <Link className="btn" href="/picking">
          ← Збирання
        </Link>
      </div>
      {!ordersEnabled() && <div className="msg warn">Потрібен ключ SalesDrive для читання заявок (SALESDRIVE_ORDERS_KEY).</div>}
      <p className="muted small">
        1) Відскануйте штрихкод на ТТН — відкриється замовлення. 2) Скануйте кожен товар, який кладете в пакунок: правильний — зелений, чужий чи зайвий —
        червоний зі звуком. 3) Коли все відскановано, замовлення саме позначиться запакованим — клейте ТТН і скануйте наступну.
      </p>
      <PackStation />
    </>
  );
}
