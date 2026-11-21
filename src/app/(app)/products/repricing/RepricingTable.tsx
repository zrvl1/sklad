"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { savePrices } from "./actions";

type Row = { id: number; name: string; sku: string | null; image: string | null; category: string | null; stock: number; price: number; cost: number; promPct: number | null };

const fmt = (v: number) => v.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const color = (m: number) => (m < 15 ? "var(--err)" : m < 30 ? "var(--warn)" : "var(--ok)");
const roundPrice = (v: number) => (v >= 100 ? Math.ceil(v / 10) * 10 : Math.ceil(v)); // до 10 грн угору

function Margins({ price, cost, promPct }: { price: number; cost: number; promPct: number | null }) {
  if (!(price > 0) || !(cost > 0)) return <span className="muted">—</span>;
  const m = Math.round(((price - cost) / price) * 100);
  const pc = promPct ? (price * promPct) / 100 : 0;
  const mp = Math.round(((price - cost - pc) / price) * 100);
  return (
    <>
      <div style={{ color: color(m), whiteSpace: "nowrap" }}>
        {m}% · {Math.round(price - cost)} грн
      </div>
      {promPct ? (
        <div style={{ color: color(mp), whiteSpace: "nowrap" }} title={`Комісія Prom ${promPct}% ≈ ${Math.round(pc)} грн`}>
          Prom {mp}% · {Math.round(price - cost - pc)} грн
        </div>
      ) : null}
    </>
  );
}

export default function RepricingTable({ rows }: { rows: Row[] }) {
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [target, setTarget] = useState("30");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const t = Number(target) || 0;

  // ціна, щоб маржа (з комісією Prom, якщо є) була не нижче цільової
  const suggest = (r: Row) => {
    const k = 1 - t / 100 - (r.promPct ?? 0) / 100;
    return r.cost > 0 && k > 0 ? roundPrice(r.cost / k) : null;
  };
  const changes = rows
    .map((r) => ({ id: r.id, price: Number((prices[r.id] ?? "").replace(",", ".")) }))
    .filter((c, i) => c.price > 0 && c.price !== rows[i].price);

  const save = () =>
    start(async () => {
      const r = await savePrices(changes);
      setMsg(r);
      if (r.ok) setPrices({});
    });

  return (
    <div className="panel">
      <div className="toolbar" style={{ marginTop: 0 }}>
        <span className="small">Цільова маржа</span>
        <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" style={{ width: 60 }} />
        <span className="small">%</span>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            const next: Record<number, string> = { ...prices };
            for (const r of rows) {
              const s = suggest(r);
              const m = r.price > 0 && r.cost > 0 ? ((r.price - r.cost - (r.price * (r.promPct ?? 0)) / 100) / r.price) * 100 : null;
              if (s && m !== null && m < t) next[r.id] = String(s);
            }
            setPrices(next);
          }}
          title="Вписати рекомендовану ціну всім товарам на сторінці, де маржа нижча за цільову"
        >
          Підставити для всіх нижче цілі
        </button>
        <span style={{ flex: 1 }} />
        {msg && <span className="small" style={{ color: msg.ok ? "var(--ok)" : "var(--err)" }}>{msg.text}</span>}
        <button type="button" className="btn primary" disabled={pending || !changes.length} onClick={save}>
          {pending ? "Зберігаю…" : `Зберегти ціни (${changes.length})`}
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 52 }} />
            <th>Товар</th>
            <th className="num">Залишок</th>
            <th className="num">Собівартість</th>
            <th className="num">Ціна</th>
            <th className="num">Маржа зараз</th>
            <th className="num" title={`Ціна, щоб маржа (з комісією Prom, якщо є) була ${t}%`}>
              Ціна для {t}%
            </th>
            <th style={{ width: 110 }}>Нова ціна</th>
            <th className="num">Маржа з новою</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="muted">
                Нічого не знайдено
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const np = Number((prices[r.id] ?? "").replace(",", "."));
            const s = suggest(r);
            return (
              <tr key={r.id}>
                <td>
                  {r.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image} alt="" loading="lazy" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", border: "1px solid var(--line)", borderRadius: 4 }} />
                  ) : null}
                </td>
                <td>
                  <Link href={`/products/${r.id}`}>{r.name}</Link>
                  <div className="muted small">
                    {[r.sku, r.category].filter(Boolean).join(" · ")}
                    {r.promPct ? ` · Prom ${r.promPct}%` : ""}
                  </div>
                </td>
                <td className="num">{r.stock}</td>
                <td className="num">{r.cost > 0 ? fmt(r.cost) : <span className="badge warn">немає</span>}</td>
                <td className="num">
                  <b>{fmt(r.price)}</b>
                </td>
                <td className="num small">
                  <Margins price={r.price} cost={r.cost} promPct={r.promPct} />
                </td>
                <td className="num">
                  {s ? (
                    <button type="button" className="btn sm" onClick={() => setPrices({ ...prices, [r.id]: String(s) })} title="Підставити в «Нова ціна»">
                      {s}
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    placeholder="без змін"
                    value={prices[r.id] ?? ""}
                    onChange={(e) => setPrices({ ...prices, [r.id]: e.target.value })}
                    style={{ width: 100, borderColor: np > 0 && np !== r.price ? "#2563eb" : undefined }}
                  />
                </td>
                <td className="num small">{np > 0 ? <Margins price={np} cost={r.cost} promPct={r.promPct} /> : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
