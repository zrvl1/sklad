"use client";

import type { TreeOpt } from "@/components/CategoryTreeSelect";
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
  prevCost: number; // попередня собівартість товару — для перевірки помилок введення
  newPrice: number | null;
  cellId: number | null;
  image?: string | null;
  stockTotal?: number; // зараз на складі (до проведення цього приходу)
  promPct?: number | null; // комісія Prom за категорією товару (% від ціни)
  promCat?: string | null; // категорія товару на Prom
};

/** Попередження по рядку приходу: ловимо типові помилки введення до проведення */
function lineWarnings(l: Line, rate: number) {
  const w: string[] = [];
  const costUah = l.cost * rate;
  const sale = l.newPrice ?? l.price;
  if (l.cost <= 0) w.push("закупівля 0");
  if (sale > 0 && costUah > sale) w.push(`закупівля (${costUah.toFixed(2)}) вища за ціну продажу (${sale})`);
  if (l.prevCost > 0 && l.cost > 0 && Math.abs(costUah - l.prevCost) / l.prevCost > 0.5) w.push(`закупівля відрізняється від попередньої (${l.prevCost}) більш ніж на 50%`);
  if (l.newPrice !== null && l.newPrice <= 0) w.push("нова ціна 0");
  if (l.qty > 1000) w.push("дуже велика кількість");
  if (!Number.isInteger(l.qty)) w.push("дробова кількість");
  return w;
}

type Found = { id: number; name: string; sku: string | null; barcode: string | null; price: number; cost: number; matchedBy?: string; image?: string | null; stockTotal?: number; promPct?: number | null; promCat?: string | null };

type Props = {
  receiptId: number;
  initial: Omit<ReceiptInput, "lines"> & { lines: Line[] };
  warehouses: { id: number; name: string }[];
  suppliers: { id: number; name: string; currency?: string }[];
  cells: { id: number; code: string; warehouseId: number }[];
  rates: Record<string, number>; // курси з SalesDrive: гривень за 1 одиницю
  showCurrency: boolean;
  categories: TreeOpt[];
  canCreate: boolean;
};

const fmt = (v: number) => v.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (s: string) => {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

export default function ReceiptEditor({ receiptId, initial, warehouses, suppliers, cells, rates, showCurrency, categories, canCreate }: Props) {
  const router = useRouter();
  const [header, setHeader] = useState({
    date: initial.date,
    warehouseId: initial.warehouseId,
    supplierId: initial.supplierId,
    invoiceNo: initial.invoiceNo,
    note: initial.note,
    currency: initial.currency || "UAH",
    rate: initial.rate ?? "",
  });
  const cur = header.currency;
  const ownRate = parseFloat(String(header.rate).replace(",", "."));
  const rate = cur === "UAH" ? 1 : ownRate > 0 ? ownRate : rates[cur] ?? 0;
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
          prevCost: p.cost,
          image: p.image ?? null,
          stockTotal: p.stockTotal,
          promPct: p.promPct ?? null,
          promCat: p.promCat ?? null,
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
    const warns = lines.flatMap((l) => lineWarnings(l, rate || 1).map((w) => `• ${l.name}: ${w}`));
    if (warns.length && !confirm(`Перевірте перед проведенням:\n${warns.slice(0, 15).join("\n")}${warns.length > 15 ? `\n…ще ${warns.length - 15}` : ""}\n\nВсе правильно, проводимо?`)) return;
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
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              // валюта закупівлі — як у постачальника (ТАТА — USD)
              const sc = suppliers.find((s) => s.id === id)?.currency;
              setHeader({ ...header, supplierId: id, ...(showCurrency && sc ? { currency: sc } : {}) });
              touch();
            }}
          >
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {showCurrency && (
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
              <>
                <span className="small">курс приходу:</span>
                <input
                  value={header.rate}
                  onChange={(e) => (setHeader({ ...header, rate: e.target.value }), touch())}
                  placeholder={rates[cur] ? String(rates[cur]) : "курс"}
                  inputMode="decimal"
                  style={{ width: 80 }}
                  title="Порожньо — курс дня. Впишіть свій, якщо валюту за цю накладну вже купили за іншим курсом"
                />
                <span className="small muted">
                  {ownRate > 0 ? `свій курс (курс дня ${rates[cur] ?? "—"})` : rates[cur] ? "порожньо — курс дня" : "немає курсу — введіть у «Постачальники»"}
                </span>
              </>
            )}
          </span>
        </label>
        )}
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
          {canCreate && (
            <button className="btn sm" onClick={() => setUnknown(null)}>
              + Новий товар
            </button>
          )}
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
            categories={categories}
            canCreate={canCreate}
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
              <th style={{ width: 52 }}>Фото</th>
              <th>Товар</th>
              <th style={{ width: 80 }} className="num">На складі</th>
              <th style={{ width: 90 }}>К-сть</th>
              <th style={{ width: 110 }}>Закупівля, {cur === "UAH" ? "грн" : cur}</th>
              <th className="num">Сума, {cur === "UAH" ? "грн" : cur}</th>
              <th style={{ width: 110 }}>Нова ціна, грн</th>
              <th style={{ width: 130 }}>Комірка</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>
                  {l.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.image} alt="" loading="lazy" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", border: "1px solid var(--line)", borderRadius: 4 }} />
                  ) : (
                    <span className="muted small">—</span>
                  )}
                </td>
                <td>
                  {l.name}
                  <div className="muted small">
                    {[l.sku, l.barcode].filter(Boolean).join(" · ")}
                  </div>
                  {lineWarnings(l, rate || 1).map((w) => (
                    <div key={w} className="small" style={{ color: "var(--warn)" }}>
                      ⚠ {w}
                    </div>
                  ))}
                </td>
                <td className="num">{l.stockTotal === undefined ? "—" : <b style={{ color: l.stockTotal > 0 ? undefined : "var(--muted, #888)" }}>{l.stockTotal}</b>}</td>
                <td>
                  <input type="number" min={0} step="any" value={l.qty} onChange={(e) => update(l.key, { qty: n(e.target.value) })} />
                </td>
                <td>
                  <input inputMode="decimal" defaultValue={l.cost} onChange={(e) => update(l.key, { cost: n(e.target.value) })} />
                  <div className="muted small" title="Поточна собівартість товару">
                    зараз {l.prevCost > 0 ? fmt(l.prevCost) : "—"}
                  </div>
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
                  <div className="muted small" title="Поточна ціна продажу">
                    зараз {fmt(l.price)}
                  </div>
                  {(() => {
                    // націнка з новою закупівлею: на нову ціну (якщо вписали) або на поточну
                    const sale = l.newPrice ?? l.price;
                    const c = l.cost * (rate || 1);
                    if (!(sale > 0) || !(c > 0)) return null;
                    const m = Math.round(((sale - c) / sale) * 100);
                    const color = (x: number) => (x < 15 ? "var(--err)" : x < 30 ? "var(--warn)" : "var(--ok)");
                    const pc = l.promPct ? (sale * l.promPct) / 100 : 0;
                    const mp = Math.round(((sale - c - pc) / sale) * 100);
                    return (
                      <>
                        <div className="small" style={{ color: color(m) }} title="Маржа: (ціна − закупівля) / ціна">
                          маржа {m}% · {fmt(sale - c)} грн
                        </div>
                        {l.promPct ? (
                          <div
                            className="small"
                            style={{ color: color(mp) }}
                            title={`Якщо продати через Prom: комісія ${l.promPct}% (категорія Prom: ${l.promCat ?? "?"}) ≈ ${fmt(pc)} грн`}
                          >
                            з Prom {mp}% · {fmt(sale - c - pc)} грн
                            <span className="muted"> (−{l.promPct}%)</span>
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
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
                <td colSpan={9} className="muted">
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
