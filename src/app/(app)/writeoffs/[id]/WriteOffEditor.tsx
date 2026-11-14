"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { WRITE_OFF_REASONS } from "@/lib/labels";
import { postWriteOff, saveWriteOff } from "../actions";

type Line = { key: string; productId: number; name: string; sku: string | null; barcode: string | null; cost: number; stock: number; qty: number; cellId: number | null };
type Found = { id: number; name: string; sku: string | null; barcode: string | null; cost: number; stock?: number; matchedBy?: string };

const fmt = (v: number) => v.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function WriteOffEditor(props: {
  id: number;
  warehouseId: number;
  reason: string;
  note: string;
  lines: Line[];
  cells: { id: number; code: string }[];
}) {
  const router = useRouter();
  const [reason, setReason] = useState(props.reason);
  const [note, setNote] = useState(props.note);
  const [lines, setLines] = useState<Line[]>(props.lines);
  const [cellId, setCellId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [msg, setMsg] = useState<{ type: "ok" | "err" | "warn"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const add = (p: Found) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id && l.cellId === cellId);
      if (i >= 0) {
        const copy = [...ls];
        const [row] = copy.splice(i, 1);
        return [{ ...row, qty: row.qty + 1 }, ...copy];
      }
      return [
        { key: `n${Date.now()}${p.id}`, productId: p.id, name: p.name, sku: p.sku, barcode: p.barcode, cost: p.cost, stock: p.stock ?? 0, qty: 1, cellId },
        ...ls,
      ];
    });
    setDirty(true);
    setQuery("");
    setResults([]);
    scanRef.current?.focus();
  };

  const search = async (q: string) => {
    const code = q.trim();
    if (!code) return;
    if (code.toUpperCase().startsWith("CELL:")) {
      const c = props.cells.find((x) => x.code === code.slice(5).toUpperCase());
      setQuery("");
      if (c) {
        setCellId(c.id);
        setMsg({ type: "ok", text: `Списуємо з комірки ${c.code}` });
      } else setMsg({ type: "err", text: "Комірку не знайдено на цьому складі" });
      return;
    }
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(code)}&wh=${props.warehouseId}`);
    const found: Found[] = res.ok ? await res.json() : [];
    if (found.length === 1) return add(found[0]);
    setResults(found);
    if (!found.length) setMsg({ type: "warn", text: `Товар «${code}» не знайдено` });
  };

  const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
  const over = lines.filter((l) => l.qty > l.stock);
  const payload = () => ({ reason, note, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, cellId: l.cellId })) });

  const save = () =>
    start(async () => {
      const r = await saveWriteOff(props.id, payload());
      if (r.ok) {
        setDirty(false);
        setMsg({ type: "ok", text: "Збережено" });
      } else setMsg({ type: "err", text: r.error });
    });

  const post = () => {
    if (!lines.length) return;
    if (!confirm(`Списати ${lines.reduce((s, l) => s + l.qty, 0)} шт на ${fmt(total)} грн (причина: ${reason})?\nЗалишки в SalesDrive буде зменшено.`)) return;
    start(async () => {
      const s = await saveWriteOff(props.id, payload());
      if (!s.ok) return setMsg({ type: "err", text: s.error });
      setDirty(false);
      const r = await postWriteOff(props.id);
      if (!r.ok) return setMsg({ type: "err", text: r.error });
      router.refresh();
    });
  };

  const cellCode = (id: number | null) => props.cells.find((c) => c.id === id)?.code;

  return (
    <>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
      <div className="panel grid2">
        <label>
          Причина
          <select value={reason} onChange={(e) => (setReason(e.target.value), setDirty(true))}>
            {WRITE_OFF_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          Коментар
          <input value={note} onChange={(e) => (setNote(e.target.value), setDirty(true))} placeholder="напр. пошкоджено при доставці" />
        </label>
      </div>

      <div className="panel">
        <div className="toolbar">
          <span>Комірка:</span>
          <select value={cellId ?? ""} onChange={(e) => setCellId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">автоматично (звідки лежить)</option>
            {props.cells.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
          <span className="muted small">або відскануйте етикетку комірки</span>
        </div>
        <input
          ref={scanRef}
          className="scan"
          autoFocus
          placeholder="Скануйте товар або введіть назву / артикул"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search(query);
            }
          }}
        />
        {results.length > 0 && (
          <div className="results">
            {results.map((r) => (
              <button key={r.id} onClick={() => add(r)}>
                {r.name} <span className="muted small">{[r.sku, r.barcode, r.stock !== undefined && `на складі ${r.stock}`].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {over.length > 0 && <div className="msg warn">Списуєте більше, ніж є на складі: {over.map((l) => l.name).join(", ")}</div>}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th>Комірка</th>
              <th className="num">На складі</th>
              <th style={{ width: 100 }}>Списати</th>
              <th className="num">Сума (собів.)</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>
                  {l.name}
                  <div className="muted small">{[l.sku, l.barcode].filter(Boolean).join(" · ")}</div>
                </td>
                <td>{cellCode(l.cellId) ?? <span className="muted">авто</span>}</td>
                <td className="num">{l.stock}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={l.qty}
                    onChange={(e) => {
                      const v = Math.max(0, parseFloat(e.target.value) || 0);
                      setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: v } : x)));
                      setDirty(true);
                    }}
                  />
                </td>
                <td className="num">{fmt(l.qty * l.cost)}</td>
                <td>
                  <button
                    className="btn sm danger"
                    onClick={() => {
                      setLines((ls) => ls.filter((x) => x.key !== l.key));
                      setDirty(true);
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Відскануйте товар для списання
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <span>
          Позицій: <b>{lines.length}</b> · Сума за собівартістю: <b>{fmt(total)} грн</b>
        </span>
        <span className="spacer" />
        <button className="btn" disabled={pending} onClick={save}>
          Зберегти{dirty ? " *" : ""}
        </button>
        <button className="btn primary" disabled={pending || !lines.length || over.length > 0} onClick={post}>
          {pending ? "Зачекайте…" : "Провести списання"}
        </button>
      </div>
    </>
  );
}
