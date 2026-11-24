"use client";

import { useEffect, useState } from "react";

const SEP = " › ";
const KEY = "catTreeOpen";

/**
 * Згортання/розгортання дерева категорій. Рядки таблиці мають data-path; кнопки — data-toggle.
 * Стан запам'ятовується в браузері. Відкрита на редагування/видалення категорія завжди видима.
 */
export default function CategoryTreeToggle({ tableId }: { tableId: string }) {
  const [open, setOpen] = useState<Set<string> | null>(null);

  useEffect(() => {
    let saved: string[] | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    } catch {}
    const s = new Set<string>(saved ?? []);
    // предки рядка, що редагується, — розгорнуті
    const focus = document.querySelector<HTMLElement>(`#${tableId} tr[data-focus]`)?.dataset.path;
    if (focus) {
      const parts = focus.split(SEP);
      for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join(SEP));
    }
    setOpen(s);
  }, [tableId]);

  useEffect(() => {
    if (!open) return;
    const table = document.getElementById(tableId);
    if (!table) return;
    const rows = table.querySelectorAll<HTMLElement>("tr[data-path]");
    rows.forEach((r) => {
      const parts = r.dataset.path!.split(SEP);
      let visible = true;
      for (let i = 1; i < parts.length; i++) if (!open.has(parts.slice(0, i).join(SEP))) visible = false;
      r.style.display = visible ? "" : "none";
      const btn = r.querySelector<HTMLElement>("[data-toggle]");
      if (btn) btn.textContent = open.has(r.dataset.path!) ? "▾" : "▸";
    });
    try {
      localStorage.setItem(KEY, JSON.stringify([...open]));
    } catch {}
  }, [open, tableId]);

  useEffect(() => {
    const table = document.getElementById(tableId);
    if (!table) return;
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-toggle]");
      if (!btn) return;
      e.preventDefault();
      const p = btn.dataset.toggle!;
      setOpen((prev) => {
        const s = new Set(prev ?? []);
        if (s.has(p)) s.delete(p);
        else s.add(p);
        return s;
      });
    };
    table.addEventListener("click", onClick);
    return () => table.removeEventListener("click", onClick);
  }, [tableId]);

  const all = () => {
    const s = new Set<string>();
    document.querySelectorAll<HTMLElement>(`#${tableId} [data-toggle]`).forEach((b) => s.add(b.dataset.toggle!));
    setOpen(s);
  };

  return (
    <div className="row" style={{ gap: 6, marginBottom: 8 }}>
      <button type="button" className="btn sm" onClick={all}>
        ▾ Розгорнути все
      </button>
      <button type="button" className="btn sm" onClick={() => setOpen(new Set())}>
        ▸ Згорнути все
      </button>
    </div>
  );
}
