"use client";

import { useRef, useState } from "react";
import { shrink } from "@/lib/shrink";

/** Фото у формі нового товару: стискаються в браузері й відправляються разом із формою */
export default function NewPhotos() {
  const hidden = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const apply = (list: File[]) => {
    setFiles(list);
    const dt = new DataTransfer();
    list.forEach((f) => dt.items.add(f));
    if (hidden.current) hidden.current.files = dt.files;
  };
  const add = async (fl: FileList | null) => {
    if (!fl?.length) return;
    setBusy(true);
    const shrunk: File[] = [];
    for (const f of [...fl]) {
      try {
        shrunk.push(await shrink(f));
      } catch {
        /* не картинка — пропускаємо */
      }
    }
    apply([...files, ...shrunk].slice(0, 8));
    setBusy(false);
  };

  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <b>Фото</b>
        <label className="btn sm" style={{ cursor: "pointer" }}>
          ＋ Додати фото
          <input type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
        </label>
        <span className="small muted">{busy ? "Стискаю…" : "до 8 шт., перше — головне; підуть у SalesDrive разом із товаром"}</span>
      </div>
      <input ref={hidden} type="file" name="photos" multiple hidden />
      {files.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {files.map((f, i) => (
            <div key={i} style={{ position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={URL.createObjectURL(f)} alt="" style={{ width: 80, height: 80, objectFit: "contain", background: "#fff", border: i === 0 ? "2px solid #2563eb" : "1px solid var(--line)", borderRadius: 6 }} />
              <button type="button" className="btn sm" style={{ position: "absolute", top: 2, right: 2, padding: "0 6px" }} onClick={() => apply(files.filter((_, j) => j !== i))}>
                ×
              </button>
              {i > 0 && (
                <button type="button" className="btn sm" style={{ position: "absolute", bottom: 2, left: 2, padding: "0 4px", fontSize: 11 }} onClick={() => apply([f, ...files.filter((_, j) => j !== i)])}>
                  ★
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
