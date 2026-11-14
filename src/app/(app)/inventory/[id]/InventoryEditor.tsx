"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import UnknownCode, { type Found } from "@/components/UnknownCode";
import { postInventory, saveInventory } from "../actions";

type Line = { key: string; productId: number; name: string; sku: string | null; barcode: string | null; cellId: number | null; counted: number };

type Props = {
  inventoryId: number;
  warehouseId: number;
  note: string;
  lines: Line[];
  stock: Record<number, number>; // залишок за обліком на момент відкриття
  cells: { id: number; code: string }[];
  suppliers: { id: number; name: string }[];
  categories: string[];
};

const keyOf = (productId: number, cellId: number | null) => `${productId}:${cellId ?? 0}`;

export default function InventoryEditor(props: Props) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(props.lines);
  const [stock, setStock] = useState<Record<number, number>>(props.stock);
  const [note, setNote] = useState(props.note);
  const [cellId, setCellId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<(Found & { stock?: number })[]>([]);
  const [unknown, setUnknown] = useState<string | null | undefined>(undefined);
  const [msg, setMsg] = useState<{ type: "ok" | "err" | "warn"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [zeroMissing, setZeroMissing] = useState(false);
  const [pending, start] = useTransition();
  const scanRef = useRef<HTMLInputElement>(null);
  const cellCode = (id: number | null) => props.cells.find((c) => c.id === id)?.code ?? "без комірки";

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // Автозбереження кожні 30 секунд, щоб не втратити порахуване
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      saveInventory(props.inventoryId, note, lines).then((r) => r.ok && setDirty(false));
    }, 30000);
    return () => clearTimeout(t);
  }, [dirty, lines, note, props.inventoryId]);

  const add = (p: Found & { stock?: number }, qty = 1) => {
    if (p.stock !== undefined) setStock((s) => ({ ...s, [p.id]: p.stock! }));
    setLines((ls) => {
      const k = keyOf(p.id, cellId);
      const i = ls.findIndex((l) => l.key === k);
      if (i >= 0) {
        const copy = [...ls];
        const [row] = copy.splice(i, 1);
        return [{ ...row, counted: row.counted + qty }, ...copy];
      }
      return [{ key: k, productId: p.id, name: p.name, sku: p.sku, barcode: p.barcode, cellId, counted: qty }, ...ls];
    });
    setDirty(true);
    setQuery("");
    setResults([]);
    setMsg({ type: "ok", text: `+${qty} «${p.name}» → ${cellCode(cellId)}` });
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
        setMsg({ type: "ok", text: `Рахуємо комірку ${c.code}` });
      } else setMsg({ type: "err", text: `Комірку ${code.slice(5)} не знайдено на цьому складі` });
      return;
    }
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(code)}&wh=${props.warehouseId}`);
    const found: (Found & { stock?: number })[] = res.ok ? await res.json() : [];
    if (found.length === 1) return add(found[0]);
    setResults(found);
    if (!found.length) {
      if (/\s/.test(code)) setMsg({ type: "warn", text: `За запитом «${code}» нічого не знайдено` });
      else {
        setMsg(null);
        setUnknown(code);
        setQuery("");
      }
    }
  };

  // Підсумок по товару: пораховано (усі комірки) vs за обліком
  const summary = useMemo(() => {
    const m = new Map<number, { name: string; counted: number }>();
    for (const l of lines) m.set(l.productId, { name: l.name, counted: (m.get(l.productId)?.counted ?? 0) + l.counted });
    return [...m.entries()].map(([id, v]) => ({ id, ...v, system: stock[id] ?? 0 }));
  }, [lines, stock]);
  const diffs = summary.filter((s) => Math.abs(s.counted - s.system) > 1e-9);

  const save = () =>
    start(async () => {
      const r = await saveInventory(props.inventoryId, note, lines);
      if (r.ok) {
        setDirty(false);
        setMsg({ type: "ok", text: "Збережено" });
      } else setMsg({ type: "err", text: r.error });
    });

  const post = () => {
    if (!lines.length) return;
    // великі розбіжності частіше означають помилку сканування, ніж реальну нестачу
    const big = diffs.filter((d) => Math.abs(d.counted - d.system) >= 5 || (d.system > 0 && Math.abs(d.counted - d.system) / d.system > 0.5));
    const bigText = big.length
      ? `\n\n⚠ Великі розбіжності — перевірте:\n${big
          .slice(0, 10)
          .map((d) => `• ${d.name}: облік ${d.system}, факт ${d.counted}`)
          .join("\n")}`
      : "";
    if (
      !confirm(
        `Провести інвентаризацію?\nПораховано товарів: ${summary.length}, з розбіжностями: ${diffs.length}.\nЗалишки цих товарів у SalesDrive буде встановлено рівними порахованим.${bigText}`
      )
    )
      return;
    start(async () => {
      const s = await saveInventory(props.inventoryId, note, lines);
      if (!s.ok) return setMsg({ type: "err", text: s.error });
      setDirty(false);
      const r = await postInventory(props.inventoryId, zeroMissing);
      if (!r.ok) return setMsg({ type: "err", text: r.error });
      router.refresh();
    });
  };

  return (
    <>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="panel">
        <div className="toolbar">
          <span>Поточна комірка:</span>
          <select value={cellId ?? ""} onChange={(e) => setCellId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">без комірки</option>
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
          placeholder="Скануйте товар (кожне сканування = +1)"
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
                {r.name} <span className="muted small">{[r.sku, r.barcode].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        )}
        {unknown !== undefined && (
          <UnknownCode
            key={unknown ?? "new"}
            code={unknown}
            supplierId={null}
            suppliers={props.suppliers}
            categories={props.categories}
            onCancel={() => setUnknown(undefined)}
            onDone={(p, note) => {
              setUnknown(undefined);
              add({ ...p, stock: 0 });
              if (note) setMsg({ type: "ok", text: note });
            }}
          />
        )}
      </div>

      <div className="grid2">
        <div>
          <h2 style={{ marginTop: 0 }}>Пораховано по комірках</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Комірка</th>
                  <th style={{ width: 100 }}>К-сть</th>
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
                    <td>{cellCode(l.cellId)}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={l.counted}
                        onChange={(e) => {
                          const v = Math.max(0, parseFloat(e.target.value) || 0);
                          setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, counted: v } : x)));
                          setDirty(true);
                        }}
                      />
                    </td>
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
                    <td colSpan={4} className="muted">
                      Відскануйте комірку, потім товари в ній
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 style={{ marginTop: 0 }}>
            Розбіжності <span className="badge warn">{diffs.length}</span>
          </h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Товар</th>
                  <th className="num">Облік</th>
                  <th className="num">Факт</th>
                  <th className="num">Різниця</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => {
                  const d = s.counted - s.system;
                  return (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td className="num">{s.system}</td>
                      <td className="num">{s.counted}</td>
                      <td className="num" style={{ color: d < 0 ? "var(--err)" : d > 0 ? "var(--ok)" : undefined, fontWeight: d ? 700 : 400 }}>
                        {d > 0 ? "+" : ""}
                        {d}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">«Облік» — залишок у SalesDrive на момент сканування. При проведенні він оновиться ще раз.</p>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <label>
          Коментар
          <input value={note} onChange={(e) => (setNote(e.target.value), setDirty(true))} />
        </label>
        <label className="check" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={zeroMissing} onChange={(e) => setZeroMissing(e.target.checked)} />
          Комірки перераховано повністю: товари, яких не відскановано в цих комірках, прибрати з них (залишок у CRM не змінюється)
        </label>
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <span>
            Товарів: <b>{summary.length}</b> · з розбіжностями: <b>{diffs.length}</b>
          </span>
          <span className="spacer" />
          <button className="btn" disabled={pending} onClick={save}>
            Зберегти{dirty ? " *" : ""}
          </button>
          <button className="btn primary" disabled={pending || !lines.length} onClick={post}>
            {pending ? "Зачекайте…" : "Провести"}
          </button>
        </div>
      </div>
    </>
  );
}
