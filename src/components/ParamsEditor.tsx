"use client";

import { useEffect, useState } from "react";

export type Param = { name: string; type: string; value: string };

const TYPES = [
  { v: "select", l: "список" },
  { v: "multiselect", l: "мультисписок" },
  { v: "text", l: "текст" },
  { v: "number", l: "число" },
];

/**
 * Редактор характеристик товару/шаблону. Значення пишеться в приховане поле форми як JSON.
 * value / onChange — щоб зовнішній код міг підставити характеристики з шаблону.
 */
export default function ParamsEditor({
  name,
  initial,
  value,
  onChange,
}: {
  name: string;
  initial?: Param[];
  value?: Param[];
  onChange?: (p: Param[]) => void;
}) {
  const [rows, setRows] = useState<Param[]>(value ?? initial ?? []);
  useEffect(() => {
    if (value) setRows(value);
  }, [value]);
  const set = (next: Param[]) => {
    setRows(next);
    onChange?.(next);
  };

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(rows.filter((r) => r.name.trim()))} />
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ gap: 6, marginBottom: 6 }}>
          <input
            placeholder="Назва (напр. Колір)"
            value={r.name}
            onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            style={{ width: 200 }}
          />
          <input
            placeholder="Значення"
            value={r.value}
            onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            style={{ flex: 1, minWidth: 160 }}
          />
          <select value={r.type} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} title="Тип характеристики в SalesDrive">
            {TYPES.map((t) => (
              <option key={t.v} value={t.v}>
                {t.l}
              </option>
            ))}
          </select>
          <button type="button" className="btn sm danger" onClick={() => set(rows.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => set([...rows, { name: "", type: "select", value: "" }])}>
        + Характеристика
      </button>
    </div>
  );
}
