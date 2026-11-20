"use client";

import { useState, useTransition } from "react";
import { setPhotos, uploadPhotos } from "../photo-actions";

/** Зменшити фото в браузері до 1600 px по довшій стороні, JPEG 85% — швидше вантажиться і менше місця */
async function shrink(file: File): Promise<File> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), "image/jpeg", 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

export default function ProductPhotos({ productId, images, canEdit }: { productId: number; images: string[]; canEdit: boolean }) {
  const [list, setList] = useState(images);
  const [big, setBig] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = (next: string[]) =>
    start(async () => {
      setList(next);
      setBig(0);
      const r = await setPhotos(productId, next);
      setMsg(r.warn ?? "Збережено й відправлено в SalesDrive");
    });

  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    start(async () => {
      setMsg("Стискаю й завантажую…");
      const fd = new FormData();
      for (const f of [...files].slice(0, 10)) fd.append("files", await shrink(f));
      const r = await uploadPhotos(productId, fd);
      setMsg("error" in r ? r.error! : (r.warn ?? "Фото додано й відправлено в SalesDrive"));
      if (!("error" in r)) location.reload();
    });
  };

  return (
    <div className="panel">
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <b>Фото ({list.length})</b>
        <span className="spacer" />
        {canEdit && (
          <label className="btn sm" style={{ cursor: "pointer" }}>
            ＋ Додати фото
            <input type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} disabled={pending} />
          </label>
        )}
      </div>
      {list.length === 0 ? (
        <p className="muted small">Фото немає. {canEdit ? "Додайте — можна одразу кілька, з телефона теж." : ""}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 320px) 1fr", gap: 12, alignItems: "start" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={list[big]} alt="" style={{ width: "100%", maxHeight: 320, objectFit: "contain", background: "#fff", border: "1px solid var(--line)", borderRadius: 8 }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {list.map((u, i) => (
              <div key={u} style={{ width: 92 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={u}
                  alt=""
                  onClick={() => setBig(i)}
                  style={{ width: 92, height: 92, objectFit: "contain", background: "#fff", cursor: "pointer", borderRadius: 6, border: i === big ? "2px solid var(--accent, #2563eb)" : "1px solid var(--line)" }}
                />
                {canEdit && (
                  <div className="row" style={{ gap: 2, justifyContent: "center" }}>
                    {i > 0 && (
                      <button type="button" className="btn sm" title="Зробити головним" disabled={pending} onClick={() => save([u, ...list.filter((x) => x !== u)])}>
                        ★
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn sm"
                      title="Видалити фото"
                      disabled={pending}
                      onClick={() => confirm("Видалити це фото з товару?") && save(list.filter((x) => x !== u))}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {msg && <p className="small muted" style={{ marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}
