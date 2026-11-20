"use client";

/** Виклик /api/translate з браузера. Повертає перекладені тексти або кидає помилку з текстом для людини. */
export async function translateTexts(texts: string[], from: "RU" | "UK", to: "RU" | "UK", opts: { html?: boolean; keywords?: boolean } = {}) {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts, from, to, ...opts }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `Помилка ${res.status}`);
  return j.texts as string[];
}
