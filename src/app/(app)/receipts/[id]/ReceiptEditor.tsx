"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { postReceipt, saveReceipt, type ReceiptInput } from "../actions";
import UnknownCode from "@/components/UnknownCode";

type Line = {
  key: string;
  productId: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  qty: number;
  cost: number;
  newPrice: number | null;
  cellId: number | null;
};

type Found = { id: number; name: string; sku: string | null; barcode: string | null; price: number; cost: number; matchedBy?: string };

type Props = {
  receiptId: number;
  initial: Omit<ReceiptInput, "lines"> & { lines: Line[] };
  warehouses: { id: number; name: string }[];
  suppliers: { id: number; name: string }[];
  cells: { id: number; code: string; warehouseId: number }[];
  rates: Record<string, number>; // курси з SalesDrive: гривень за 1 одиницю
};

const fmt = (v: number) => v.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (s: string) => {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

export default function ReceiptEditor({ receiptId, initial, warehouses, suppliers, cells, rates }: Props) {
  const router = useRouter();
  const [header, setHeader] = useState({
    date: initial.date,
    warehouseId: initial.warehouseId,
    supplierId: initial.supplierId,
    invoiceNo: initial.invoiceNo,
    note: initial.note,
    currency: initial.currency || "UAH",
  });
  const cur = header.currency;
  const rate = cur === "UAH" ? 1 : rates[cur] ?? 0;
  const [lines, setLines] = useState<Line[]>(initial.lines);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [msg, setMsg] = useState<{ type: "ok" | "err" | "warn"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  // невідомий код (string), створення нового товару без коду (null), або нічого (undefined)
  const [unknown, setUnknown] = useState<string | null | undefined>(undefined);
  const [activeCellId, setActiveCellId] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const scanRef = useRef<HTMLInputElement>(null);

  const whCells = useMemo(() => cells.filter((c) => c.warehouseId === header.warehouseId), [cells, header.warehouseId]);
  const total = lines.reduce((s, l) => s + l.qty * l.cost, 0); // у валюті приходу
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  // Попередження, якщо закривають сторінку з незбереженими змінами
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const touch = () => setDirty(true);

  const addProduct = (p: Found) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id);
      if (i >= 0) {
        const copy = [...ls];
        copy[i] = { ...copy[i], qty: copy[i].qty + 1 };
        // переносимо рядок нагору, щоб було видно, що кількість збільшилась
        const [row] = copy.splice(i, 1);
        return [row, ...copy];
      }
      return [
        {
          key: `n${Date.now()}${p.id}`,
          productId: p.id,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          price: p.price,
          qty: 1,
          cost: p.cost,
          newPrice: null,
          cellId: activeCellId,
        },
        ...ls,
      ];
    });
    touch();
    setQuery("");
    setResults([]);
    scanRef.current?.focus();
  };

  const search = async (q: string) => {
    if (!q.trim()) return;
    // Відсканована етикетка комірки: наступні нові товари потраплять у цю комірку
    if (q.trim().toUpperCase().startsWith("CELL:")) {
      const code = q.trim().slice(5).toUpperCase();
      const cell = whCells.find((c) => c.code === code);
      setQuery("");
      if (cell) {
        setActiveCellId(cell.id);
        setMsg({ type: "ok", text: `Комірка ${cell.code}: нові товари будуть розкладені сюди` });
      } else setMsg({ type: "err", text: `Комірку ${code} не знайдено на цьому складі` });
      return;
    }
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(q.trim())}`);
    const found: Found[] = res.ok ? await res.json() : [];
    if (found.length === 1) return addProduct(found[0]);
    setResults(found);
    if (found.length === 0) {
      if (/\s/.test(q.trim())) {
        setMsg({ type: "warn", text: `За запитом «${q}» нічого не знайдено. Можна створити новий товар.` });
      } else {
        setMsg(null);
        setUnknown(q.trim()); // невідомий код: прив'язати до наявного товару або створити новий
        setQuery("");
      }
    }
  };

  const update = (key: string, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch();
  };

  const payload = (): ReceiptInput => ({
    ...header,
    lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, cost: l.cost, newPrice: l.newPrice, cellId: l.cellId })),
  });

  const save = () =>
    start(async () => {
      const r = await saveReceipt(receiptId, payload());
      if (r.ok) {
        setDirty(false);
        setMsg({ type: "ok", text: "Збережено" });
      } else setMsg({ type: "err", text: r.error });
    });

  const post = () => {
    if (!lines.length) return setMsg({ type: "err", text: "Додайте товари" });
    const sum = cur === "UAH" ? `${fmt(total)} грн` : `${fmt(total)} ${cur} (≈ ${fmt(total * rate)} грн)`;
    if (!confirm(`Провести прихід: ${lines.length} позицій, ${totalQty} шт на ${sum}?\nЗалишки в SalesDrive буде збільшено, собівартість оновлено.`)) return;
    start(async () => {
      const s = await saveReceipt(receiptId, payload());
      if (!s.ok) return setMsg({ type: "err", text: s.error });
      setDirty(false);
      const r = await postReceipt(receiptId);
      if (!r.ok) return setMsg({ type: "err", text: r.error });
      router.replace(`/receipts/${receiptId}?posted=1${r.warning ? `&warn=${encodeURIComponent(r.warning)}` : ""}`);
      router.refresh();
    });
  };

  return (
    <>
      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="panel grid2">
        <label>
          Дата
          <input type="date" value={header.date} onChange={(e) => (setHeader({ ...header, date: e.target.value }), touch())} />
        </label>
        <label>
          Склад
          <select
            value={header.warehouseId}
            onChange={(e) => {
              setHeader({ ...header, warehouseId: Number(e.target.value) });
              setLines((ls) => ls.map((l) => ({ ...l, cellId: null })));
              setActiveCellId(null);
              touch();
            }}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Постачальник
          <select
            value={header.supplierId ?? ""}
            onChange={(e) => (setHeader({ ...header, supplierId: e.target.value ? Number(e.target.value) : null }), touch())}
          >
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Валюта закупівлі
          <span className="row" style={{ gap: 6 }}>
            <select value={cur} onChange={(e) => (setHeader({ ...header, currency: e.target.value }), touch())}>
              {Object.keys(rates).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {cur !== "UAH" && (
              <span className="small muted">{rate ? `курс SalesDrive: 1 ${cur} = ${rate} грн` : "немає курсу — додайте валюту в SalesDrive"}</span>
            )}
          </span>
        </label>
        <label>
          № накладної постачальника
          <input value={header.invoiceNo} onChange={(e) => (setHeader({ ...header, invoiceNo: e.target.value }), touch())} />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Коментар
          <input value={header.note} onChange={(e) => (setHeader({ ...header, note: e.target.value }), touch())} />
        </label>
      </div>

      <div className="panel">
        <input
          ref={scanRef}
          className="scan"
          autoFocus
          placeholder="Скануйте штрихкод або введіть назву / SKU і натисніть Enter"
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
              <button key={r.id} onClick={() => addProduct(r)}>
                {r.name} <span className="muted small">{[r.sku, r.barcode, r.matchedBy && `знайдено за: ${r.matchedBy}`].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        )}
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
          <button className="btn sm" onClick={() => setUnknown(null)}>
            + Новий товар
          </button>
          <span className="small muted">Комірка для нових рядків:</span>
          <select value={activeCellId ?? ""} onChange={(e) => setActiveCellId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {whCells.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
          <span className="small muted">(або відскануйте етикетку комірки)</span>
        </div>

        {unknown !== undefined && (
          <UnknownCode
            key={unknown ?? "new"}
            code={unknown}
            supplierId={header.supplierId}
            suppliers={suppliers}
            currency={cur}
            onCancel={() => {
              setUnknown(undefined);
              scanRef.current?.focus();
            }}
            onDone={(p, note) => {
              setUnknown(undefined);
              setMsg(note ? { type: "ok", text: note } : null);
              addProduct(p);
            }}
          />
        )}
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th style={{ width: 90 }}>К-сть</th>
              <th style={{ width: 110 }}>Закупівля, {cur}</th>
              <th className="num">Сума, {cur}</th>
              <th style={{ width: 110 }}>Нова ціна, грн</th>
              <th style={{ width: 130 }}>Комірка</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>
                  {l.name}
                  <div className="muted small">
                    {[l.sku, l.barcode].filter(Boolean).join(" · ")} · ціна зараз {fmt(l.price)}
                  </div>
                </td>
                <td>
                  <input type="number" min={0} step="any" value={l.qty} onChange={(e) => update(l.key, { qty: n(e.target.value) })} />
                </td>
                <td>
                  <input inputMode="decimal" defaultValue={l.cost} onChange={(e) => update(l.key, { cost: n(e.target.value) })} />
                </td>
                <td className="num">
                  {fmt(l.qty * l.cost)}
                  {cur !== "UAH" && rate > 0 && <div className="muted small">{fmt(l.cost * rate)} грн/шт</div>}
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    placeholder="без змін"
                    defaultValue={l.newPrice ?? ""}
                    onChange={(e) => update(l.key, { newPrice: e.target.value.trim() ? n(e.target.value) : null })}
                  />
                </td>
                <td>
                  <select value={l.cellId ?? ""} onChange={(e) => update(l.key, { cellId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">—</option>
                    {whCells.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="btn sm danger"
                    title="Прибрати"
                    onClick={() => {
                      setLines((ls) => ls.filter((x) => x.key !== l.key));
                      touch();
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Відскануйте перший товар
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <span>
          Позицій: <b>{lines.length}</b> · Штук: <b>{totalQty}</b> · Сума:{" "}
          <b>
            {fmt(total)} {cur === "UAH" ? "грн" : cur}
          </b>
          {cur !== "UAH" && rate > 0 && <span className="muted"> ≈ {fmt(total * rate)} грн</span>}
        </span>
        <span className="spacer" />
        <button className="btn" disabled={pending} onClick={save}>
          Зберегти чернетку{dirty ? " *" : ""}
        </button>
        <button className="btn primary" disabled={pending || !lines.length} onClick={post}>
          {pending ? "Зачекайте…" : "Провести"}
        </button>
      </div>
    </>
  );
}
