/**
 * Переклад RU ↔ UA через DeepL API (ключ у змінній DEEPL_API_KEY; безкоштовний тариф — 500 000 символів на місяць).
 * HTML в описах зберігається (tag_handling=html).
 */
export const translateConfigured = () => Boolean(process.env.DEEPL_API_KEY);

export async function translate(texts: string[], from: "RU" | "UK", to: "RU" | "UK", html = false): Promise<string[]> {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new Error("Перекладач не підключено: додайте DEEPL_API_KEY у Vercel");
  const items = texts.map((t) => t ?? "");
  const idx = items.map((t, i) => (t.trim() ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return items.map(() => "");
  const host = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  const res = await fetch(`${host}/v2/translate`, {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: idx.map((i) => items[i]),
      source_lang: from,
      target_lang: to === "UK" ? "UK" : "RU",
      ...(html ? { tag_handling: "html" } : {}),
      preserve_formatting: true,
    }),
    cache: "no-store",
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`DeepL ${res.status}: ${body.slice(0, 200)}`);
  const out = items.map(() => "");
  const tr = (JSON.parse(body).translations ?? []) as { text: string }[];
  idx.forEach((i, k) => (out[i] = tr[k]?.text ?? ""));
  return out;
}
