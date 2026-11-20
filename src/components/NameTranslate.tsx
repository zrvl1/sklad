"use client";

import { useState } from "react";
import { translateTexts } from "./translateClient";

/** Кнопки біля назв: RU → UA і UA → RU (поля name / nameTranslate у тій самій формі) */
export default function NameTranslate() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (dir: "ru-ua" | "ua-ru", el: HTMLElement) => {
    const form = el.closest("form");
    const ru = form?.elements.namedItem("name") as HTMLInputElement | null;
    const ua = form?.elements.namedItem("nameTranslate") as HTMLInputElement | null;
    if (!ru || !ua) return;
    const src = dir === "ru-ua" ? ru.value : ua.value;
    if (!src.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const [t] = await translateTexts([src], dir === "ru-ua" ? "RU" : "UK", dir === "ru-ua" ? "UK" : "RU");
      (dir === "ru-ua" ? ua : ru).value = t;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="row" style={{ gap: 6 }}>
      <button type="button" className="btn sm" disabled={busy} onClick={(e) => run("ru-ua", e.currentTarget)} title="Перекласти назву з російської">
        🌐 RU → UA
      </button>
      <button type="button" className="btn sm" disabled={busy} onClick={(e) => run("ua-ru", e.currentTarget)} title="Перекласти назву з української">
        🌐 UA → RU
      </button>
      {err && <span className="small" style={{ color: "var(--err)" }}>{err}</span>}
    </span>
  );
}
