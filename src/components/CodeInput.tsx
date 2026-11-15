"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Поле штрихкоду/артикула з живою перевіркою: формат і чи не зайнятий код іншим товаром.
 * Якщо код зайнятий — форма не відправиться (setCustomValidity), а під полем буде посилання на той товар.
 */
export default function CodeInput({
  name,
  kind,
  defaultValue,
  productId,
  placeholder,
  generate = false,
}: {
  generate?: boolean; // кнопка «створити» — підставляє наступний вільний код (артикул за шаблоном або штрихкод 200…)
  name: string;
  kind: "barcode" | "sku";
  defaultValue?: string | null;
  productId?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue ?? "");
  const [state, setState] = useState<{ problem?: string | null; owner?: { id: number; name: string } | null } | null>(null);

  useEffect(() => {
    const code = value.trim();
    if (!code || code === (defaultValue ?? "")) {
      setState(null);
      ref.current?.setCustomValidity("");
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/products/check?kind=${kind}&code=${encodeURIComponent(code)}${productId ? `&except=${productId}` : ""}`);
      if (!res.ok) return;
      const d = await res.json();
      setState(d);
      // дублікат блокує збереження; помилка формату — лише попередження
      ref.current?.setCustomValidity(d.owner ? `Код уже є в товару «${d.owner.name}»` : "");
    }, 350);
    return () => clearTimeout(t);
  }, [value, kind, productId, defaultValue]);

  const [busy, setBusy] = useState(false);
  const gen = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/products/next-code?kind=${kind}`);
      if (res.ok) setValue((await res.json()).code ?? "");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <input ref={ref} name={name} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoComplete="off" style={{ flex: 1, minWidth: 0 }} />
        {generate && (
          <button type="button" className="btn sm" onClick={gen} disabled={busy} title={kind === "sku" ? "Наступний вільний артикул за шаблоном" : "Новий внутрішній штрихкод 200…"}>
            {kind === "sku" ? "↻ наступний" : "＋ створити"}
          </button>
        )}
      </span>
      {state?.owner && (
        <span style={{ color: "var(--err)", fontSize: 12 }}>
          ⛔ Уже є в товару{" "}
          <a href={`/products/${state.owner.id}`} target="_blank">
            «{state.owner.name}»
          </a>
        </span>
      )}
      {state?.problem && <span style={{ color: "var(--warn)", fontSize: 12 }}>⚠ {state.problem}</span>}
      {state && !state.owner && !state.problem && <span style={{ color: "var(--ok)", fontSize: 12 }}>✓ вільний</span>}
    </>
  );
}
