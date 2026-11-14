"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LABEL_TEMPLATES } from "@/lib/labels";

/**
 * Панель над етикетками (на папері не друкується): шаблон, комірка на наліпці, калібрування зсуву, друк.
 * Зсув X/Y зберігається у браузері окремо для кожного шаблону — налаштовується один раз під принтер.
 */
export default function PrintToolbar({ count, showTemplates = true, truncated = false }: { count: number; showTemplates?: boolean; truncated?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tpl = sp.get("tpl") ?? "40x25";
  const [ox, setOx] = useState(0);
  const [oy, setOy] = useState(0);
  const [frame, setFrame] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`labelOffset:${tpl}`) ?? "{}");
      setOx(Number(saved.x) || 0);
      setOy(Number(saved.y) || 0);
    } catch {}
  }, [tpl]);

  useEffect(() => {
    document.documentElement.style.setProperty("--ox", `${ox}mm`);
    document.documentElement.style.setProperty("--oy", `${oy}mm`);
    try {
      localStorage.setItem(`labelOffset:${tpl}`, JSON.stringify({ x: ox, y: oy }));
    } catch {}
  }, [ox, oy, tpl]);

  useEffect(() => {
    document.body.classList.toggle("print-frame", frame);
  }, [frame]);

  useEffect(() => {
    if (sp.get("auto") === "1") {
      const t = setTimeout(() => window.print(), 400); // даємо штрихкодам відмалюватися
      return () => clearTimeout(t);
    }
  }, [sp]);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (v === null) next.delete(k);
    else next.set(k, v);
    if (k === "tpl")
      try {
        localStorage.setItem("labelTemplate", v ?? "");
      } catch {}
    router.replace(`${pathname}?${next}`);
  };

  return (
    <div className="no-print" style={{ padding: 12, background: "#fff", borderBottom: "1px solid #e2e5eb", position: "sticky", top: 0, zIndex: 2 }}>
      <div className="toolbar" style={{ marginBottom: 6 }}>
        <b>Етикеток: {count}</b>
        {showTemplates && (
          <select value={tpl} onChange={(e) => setParam("tpl", e.target.value)}>
            {Object.entries(LABEL_TEMPLATES).map(([id, t]) => (
              <option key={id} value={id}>
                {t.title}
              </option>
            ))}
          </select>
        )}
        {showTemplates && (
          <label className="check">
            <input type="checkbox" checked={sp.get("cell") === "1"} onChange={(e) => setParam("cell", e.target.checked ? "1" : null)} /> комірка на наліпці
          </label>
        )}
        <button className="btn primary" onClick={() => window.print()}>
          🖨 Друкувати
        </button>
        {showTemplates && (
          <a className="btn" href={`/print/labels?test=1&tpl=${tpl}`} target="_blank">
            Тестова наліпка
          </a>
        )}
      </div>
      <div className="toolbar small" style={{ marginBottom: 0 }}>
        <span className="muted">Калібрування (якщо друкує зі зсувом):</span>
        <label className="check">
          X
          <input type="number" step="0.5" value={ox} onChange={(e) => setOx(parseFloat(e.target.value) || 0)} style={{ width: 70 }} /> мм
        </label>
        <label className="check">
          Y
          <input type="number" step="0.5" value={oy} onChange={(e) => setOy(parseFloat(e.target.value) || 0)} style={{ width: 70 }} /> мм
        </label>
        <label className="check">
          <input type="checkbox" checked={frame} onChange={(e) => setFrame(e.target.checked)} /> друкувати рамку (для перевірки)
        </label>
        <span className="muted">У вікні друку: принтер етикеток, папір {LABEL_TEMPLATES[tpl as keyof typeof LABEL_TEMPLATES]?.title ?? tpl}, поля «Немає», масштаб 100%.</span>
      </div>
      {truncated && <div className="msg warn small">Показано перші 2000 етикеток — друкуйте частинами (за категорією).</div>}
    </div>
  );
}
