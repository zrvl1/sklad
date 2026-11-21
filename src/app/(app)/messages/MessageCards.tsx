"use client";

import { useState } from "react";

const digits = (p: string) => p.replace(/\D/g, "").replace(/^0/, "380");

export default function MessageCards({ cards, phone }: { cards: { key: string; title: string; text: string }[]; phone: string }) {
  const [texts, setTexts] = useState<Record<string, string>>(Object.fromEntries(cards.map((c) => [c.key, c.text])));
  const [copied, setCopied] = useState<string | null>(null);
  const num = digits(phone);

  const copy = async (key: string) => {
    await navigator.clipboard.writeText(texts[key]);
    setCopied(key);
    setTimeout(() => setCopied(null), 2500);
  };
  const open = async (key: string, href: string) => {
    await copy(key);
    window.location.href = href;
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 12 }}>
      {cards.map((c) => (
        <div key={c.key} className="panel" style={{ margin: 0 }}>
          <b>{c.title}</b>
          <textarea
            value={texts[c.key]}
            onChange={(e) => setTexts({ ...texts, [c.key]: e.target.value })}
            rows={Math.min(18, texts[c.key].split("\n").length + 1)}
            style={{ width: "100%", marginTop: 6, fontFamily: "inherit", fontSize: 13 }}
          />
          <div className="toolbar" style={{ marginBottom: 0, flexWrap: "wrap" }}>
            <button type="button" className="btn sm" onClick={() => copy(c.key)}>
              {copied === c.key ? "✓ Скопійовано" : "Копіювати"}
            </button>
            {num && (
              <>
                <button type="button" className="btn sm primary" onClick={() => open(c.key, `viber://chat?number=%2B${num}`)}>
                  Копіювати й відкрити Viber
                </button>
                <button type="button" className="btn sm" onClick={() => open(c.key, `https://t.me/+${num}`)}>
                  … Telegram
                </button>
                <a className="btn sm" href={`sms:+${num}?body=${encodeURIComponent(texts[c.key])}`}>
                  SMS
                </a>
                <a className="btn sm" href={`tel:+${num}`}>
                  📞
                </a>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
