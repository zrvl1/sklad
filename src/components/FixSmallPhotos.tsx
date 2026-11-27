"use client";

import { useState, useTransition } from "react";
import { fixSmallPhotos } from "@/app/(app)/products/photo-actions";

// Перевірка / збільшення фото, менших за 500 px (вимога Google Merchant)
export default function FixSmallPhotos() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ids, setIds] = useState<number[]>([]);

  const run = (dry: boolean) =>
    start(async () => {
      let from = 0, checked = 0, small = 0, fixed = 0, failed = 0;
      const all: number[] = [];
      for (let i = 0; i < 40; i++) {
        setMsg(`${dry ? "Перевіряю" : "Збільшую"}… перевірено товарів: ${checked}`);
        const r = await fixSmallPhotos(dry, from);
        checked += r.checked; small += r.small; fixed += r.fixed; failed += r.failed;
        all.push(...r.fixedIds);
        if (!r.timedOut) break;
        from = r.lastId;
      }
      setIds(all);
      setMsg(
        dry
          ? `Перевірено товарів: ${checked}. Замалих фото (менше 500 px): ${small}.`
          : `Готово: збільшено фото в ${fixed} товарах (${small} фото), відправлено в SalesDrive.${failed ? ` Не вдалося: ${failed}.` : ""}`
      );
    });

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <b>Фото, менші за 500 px</b>
      <div className="muted" style={{ fontSize: 13, margin: "4px 0 8px" }}>
        Google Merchant скоро перестане приймати такі фото. Кнопка вписує фото в білий квадрат 1000×1000 без обрізання і
        відправляє в SalesDrive під новою адресою — Хорошоп і Google заберуть їх заново.
      </div>
      <button type="button" className="btn" disabled={pending} onClick={() => run(true)}>
        Перевірити
      </button>{" "}
      <button type="button" className="btn primary" disabled={pending} onClick={() => run(false)}>
        Збільшити замалі фото
      </button>
      {msg && <div style={{ marginTop: 8 }}>{msg}</div>}
      {ids.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Товари: {ids.map((id) => <a key={id} href={`/products/${id}`} style={{ marginRight: 6 }}>#{id}</a>)}
        </div>
      )}
    </div>
  );
}
