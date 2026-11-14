"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { PackLine } from "@/lib/picking";
import { loadOrderByScan, markPacked } from "./actions";

type Order = {
  id: number;
  status: string;
  ttns: string[];
  amount: number;
  packed: { at: string; by: string | null; checked: boolean } | null;
  lines: PackLine[];
};

/** Короткий звуковий сигнал: високий — ок, низький — помилка */
function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1200 : 220;
    o.type = ok ? "sine" : "square";
    g.gain.value = 0.15;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.35));
  } catch {}
}

/**
 * Пакування: скан ТТН → список товарів замовлення → скан кожного товару → «Запаковано».
 * Чужий або зайвий товар — червоним і низьким сигналом.
 */
export default function PackStation() {
  const [order, setOrder] = useState<Order | null>(null);
  const [scanned, setScanned] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<{ type: "ok" | "err" | "warn"; text: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [done, setDone] = useState(0);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement>(null);

  // поле сканування завжди у фокусі
  useEffect(() => {
    const t = setInterval(() => {
      if (document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "BUTTON") ref.current?.focus();
    }, 800);
    return () => clearInterval(t);
  }, []);

  const complete = order ? order.lines.every((l) => (scanned[l.key] ?? 0) >= l.qty) : false;

  const finish = (checked: boolean) =>
    order &&
    start(async () => {
      await markPacked(order.id, scanned, checked);
      beep(true);
      setDone((d) => d + 1);
      setMsg({ type: "ok", text: `✅ Заявку №${order.id} запаковано. Скануйте наступну ТТН.` });
      setOrder(null);
      setScanned({});
      ref.current?.focus();
    });

  // автоматично завершуємо, щойно все відскановано
  useEffect(() => {
    if (order && complete && !order.packed) finish(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete]);

  const openOrder = (code: string) =>
    start(async () => {
      const r = await loadOrderByScan(code);
      if (!r.ok) {
        beep(false);
        setMsg({ type: "err", text: r.error });
        return;
      }
      setOrder(r.order);
      setScanned({});
      beep(true);
      if (r.order.packed) {
        setMsg({ type: "warn", text: `Ця заявка вже запакована (${r.order.packed.by ?? ""}, ${new Date(r.order.packed.at).toLocaleString("uk-UA")}). Перевірте, чи не дубль.` });
      } else if (!/відправ/i.test(r.order.status)) {
        setMsg({ type: "warn", text: `Статус заявки в SalesDrive: «${r.order.status}». Переконайтеся, що її треба пакувати.` });
      } else setMsg(null);
    });

  const onScan = (raw: string) => {
    const code = raw.trim().toUpperCase().replace(/\s/g, "");
    setInput("");
    if (!code) return;
    // немає відкритої заявки або відскановано іншу ТТН — відкриваємо заявку
    if (!order) return openOrder(code);
    if (order.ttns.some((t) => t === code)) return setMsg({ type: "warn", text: "Це ТТН поточної заявки — скануйте товари" });
    const line = order.lines.find((l) => l.codes.includes(code));
    if (!line) {
      // можливо, це ТТН наступної заявки
      if (/^\d{11,20}$/.test(code) || /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code)) {
        if (!complete && !confirm("Поточну заявку ще не зібрано повністю. Перейти до іншої ТТН?")) return;
        return openOrder(code);
      }
      beep(false);
      setFlash(null);
      setMsg({ type: "err", text: `⛔ Товару з кодом ${code} немає в цій заявці!` });
      return;
    }
    const have = scanned[line.key] ?? 0;
    if (have >= line.qty) {
      beep(false);
      setMsg({ type: "err", text: `⛔ Зайве: «${line.name}» потрібно ${line.qty}, вже відскановано ${have}` });
      return;
    }
    beep(true);
    setScanned((s) => ({ ...s, [line.key]: have + 1 }));
    setFlash(line.key);
    setMsg(null);
  };

  const totalNeed = order?.lines.reduce((s, l) => s + l.qty, 0) ?? 0;
  const totalHave = order?.lines.reduce((s, l) => s + Math.min(scanned[l.key] ?? 0, l.qty), 0) ?? 0;

  return (
    <>
      <div className="panel">
        <input
          ref={ref}
          className="scan"
          autoFocus
          value={input}
          disabled={pending}
          placeholder={order ? "Скануйте товари, які кладете в пакунок" : "Скануйте штрихкод ТТН (або введіть номер заявки)"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onScan(input);
            }
          }}
        />
        <div className="toolbar small" style={{ marginTop: 8, marginBottom: 0 }}>
          <span className="muted">Запаковано за сесію: {done}</span>
          {order && (
            <>
              <span className="spacer" />
              <button className="btn sm" onClick={() => openOrder(String(order.id))}>
                Почати заявку заново
              </button>
              <button className="btn sm" onClick={() => (setOrder(null), setScanned({}), setMsg(null))}>
                Закрити
              </button>
            </>
          )}
        </div>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ fontSize: 17 }}>{msg.text}</div>}

      {order && (
        <div className="panel">
          <div className="toolbar">
            <h2 style={{ margin: 0 }}>Заявка №{order.id}</h2>
            <span className="badge">{order.status}</span>
            {order.ttns.map((t) => (
              <span key={t} className="badge">
                ТТН {t}
              </span>
            ))}
            <span className="spacer" />
            <b style={{ fontSize: 20 }}>
              {totalHave} / {totalNeed}
            </b>
          </div>
          <table>
            <thead>
              <tr>
                <th>Товар</th>
                <th>Комірка</th>
                <th className="num">Треба</th>
                <th className="num">Відскановано</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l) => {
                const have = scanned[l.key] ?? 0;
                const ok = have >= l.qty;
                return (
                  <tr key={l.key} style={{ background: ok ? "var(--ok-bg)" : flash === l.key ? "#eef5ff" : undefined }}>
                    <td style={{ fontSize: 16 }}>
                      {ok ? "✅ " : ""}
                      {l.name}
                      <div className="muted small">{l.sku ?? ""}</div>
                      {!l.productId && <div className="small" style={{ color: "var(--warn)" }}>⚠ товар не зіставлено — підтвердіть вручну</div>}
                    </td>
                    <td>{l.cells.join(", ") || "—"}</td>
                    <td className="num" style={{ fontSize: 18 }}>
                      <b>{l.qty}</b>
                    </td>
                    <td className="num" style={{ fontSize: 18 }}>
                      {have}
                    </td>
                    <td>
                      {!ok && (
                        <button
                          className="btn sm"
                          title="Додати вручну (якщо штрихкод не читається)"
                          onClick={() => setScanned((s) => ({ ...s, [l.key]: (s[l.key] ?? 0) + 1 }))}
                        >
                          +1
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!complete && (
            <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
              <span className="spacer" />
              <button
                className="btn danger"
                disabled={pending}
                onClick={() => confirm("Позначити запакованою без повної перевірки сканером?") && finish(false)}
              >
                Запаковано без перевірки
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
