"use client";

import { useState, useTransition } from "react";
import { createProductQuick, linkCode } from "@/app/(app)/products/actions";

export type Found = { id: number; name: string; sku: string | null; barcode: string | null; price: number; cost: number; sdId?: string | null };

const n = (s: string) => {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

/** Схоже на штрихкод (EAN-8/UPC/EAN-13 або довгий числовий код)? */
const looksLikeBarcode = (code: string) => /^\d{8,14}$/.test(code);

/**
 * Панель для невідомого коду: прив'язати код до наявного товару (як артикул постачальника
 * або додатковий штрихкод) або створити новий товар із цим кодом.
 * code = null — просто створення нового товару.
 */
export default function UnknownCode({
  code,
  supplierId,
  suppliers,
  currency = "UAH",
  categories = [],
  canCreate = true,
  onDone,
  onCancel,
}: {
  currency?: string; // валюта закупівлі документа
  categories?: string[];
  canCreate?: boolean; // створювати нові товари може лише адміністратор
  code: string | null;
  supplierId: number | null;
  suppliers: { id: number; name: string }[];
  onDone: (p: Found, note: string | null) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"link" | "create">(code ? "link" : "create");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [type, setType] = useState<"supplier" | "barcode">(code && looksLikeBarcode(code) ? "barcode" : "supplier");
  const [sup, setSup] = useState<number | null>(supplierId);
  const [form, setForm] = useState({ name: "", price: "", cost: "", category: "" });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const search = async () => {
    if (!q.trim()) return;
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(q.trim())}`);
    setFound(res.ok ? await res.json() : []);
  };

  const link = (p: Found) =>
    start(async () => {
      if (!code) return;
      const r = await linkCode({ productId: p.id, code, type, supplierId: type === "supplier" ? sup : null });
      if (!r.ok) return setErr(r.error);
      onDone(p, `Код ${code} прив'язано до «${p.name}». Наступного разу товар знайдеться автоматично.`);
    });

  const create = () =>
    start(async () => {
      const r = await createProductQuick({
        name: form.name,
        price: n(form.price),
        cost: n(form.cost),
        costCurrency: currency,
        categoryName: form.category,
        barcode: code && type === "barcode" ? code : undefined,
        supplierCode: code && type === "supplier" ? code : undefined,
        supplierId: sup,
      });
      if (!r.ok) return setErr(r.error);
      onDone(r.product, r.warning ?? `Товар «${r.product.name}» створено (артикул ${r.product.sku ?? "—"}, штрихкод ${r.product.barcode ?? "—"})`);
    });

  const typeSelect = code && (
    <span className="row" style={{ gap: 6 }}>
      <select value={type} onChange={(e) => setType(e.target.value as "supplier" | "barcode")}>
        <option value="supplier">як артикул постачальника</option>
        <option value="barcode">як штрихкод</option>
      </select>
      {type === "supplier" && (
        <select value={sup ?? ""} onChange={(e) => setSup(e.target.value ? Number(e.target.value) : null)}>
          <option value="">постачальник…</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </span>
  );

  return (
    <div style={{ marginTop: 12, padding: 12, background: "#f7f8fa", borderRadius: 6, border: "1px solid var(--line)" }}>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <b>{code ? `Код «${code}» не знайдено` : "Новий товар"}</b>
        {code && (
          <>
            <button className={`btn sm ${mode === "link" ? "primary" : ""}`} onClick={() => setMode("link")}>
              Прив'язати до наявного товару
            </button>
            {canCreate ? (
              <button className={`btn sm ${mode === "create" ? "primary" : ""}`} onClick={() => setMode("create")}>
                Створити новий товар
              </button>
            ) : (
              <span className="muted small">Новий товар створює адміністратор — якщо це аналог наявного товару, прив&apos;яжіть код до нього</span>
            )}
          </>
        )}
        <span className="spacer" />
        <button className="btn sm" onClick={onCancel}>
          Скасувати
        </button>
      </div>
      {err && <div className="msg err">{err}</div>}

      {mode === "link" && code && (
        <>
          <div className="row">
            <input
              autoFocus
              value={q}
              placeholder="Знайдіть товар за назвою або артикулом"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  search();
                }
              }}
              style={{ flex: 1, minWidth: 220 }}
            />
            <button className="btn" onClick={search}>
              Знайти
            </button>
            {typeSelect}
          </div>
          {found.length > 0 && (
            <div className="results">
              {found.map((p) => (
                <button key={p.id} disabled={pending} onClick={() => link(p)}>
                  {p.name} <span className="muted small">{[p.sku, p.barcode].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {mode === "create" && canCreate && (
        <div className="row">
          <datalist id="uc-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <label style={{ flex: 2, minWidth: 200 }}>
            Назва
            <input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label style={{ width: 170 }}>
            Категорія
            <input list="uc-categories" value={form.category} placeholder="для шаблону опису" onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </label>
          <label style={{ width: 110 }}>
            Закупівля, {currency}
            <input inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          </label>
          <label style={{ width: 110 }}>
            Ціна продажу, грн
            <input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </label>
          {typeSelect}
          <button className="btn primary" disabled={pending || !form.name.trim()} onClick={create}>
            Створити й додати
          </button>
          <span className="muted small" style={{ width: "100%" }}>
            Артикул і штрихкод (якщо не вказано) згенеруються автоматично, опис і характеристики підставляться з шаблону категорії, товар одразу
            з'явиться в SalesDrive.
          </span>
        </div>
      )}
    </div>
  );
}
