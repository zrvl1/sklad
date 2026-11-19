"use client";

import { useEffect, useRef, useState } from "react";
import ParamsEditor, { type Param } from "./ParamsEditor";
import { translateKeywords } from "@/lib/ruua";

export type ClientTemplate = {
  id: number;
  name: string;
  categoryName: string | null;
  description: string | null;
  descriptionTranslate?: string | null;
  keywords?: string | null;
  keywordsUa?: string | null;
  country?: string | null;
  params: Param[];
};

const render = (text: string, f: Record<string, string>) =>
  text
    .replaceAll("{name}", f.name ?? "")
    .replaceAll("{sku}", f.sku ?? "")
    .replaceAll("{barcode}", f.barcode ?? "")
    .replaceAll("{manufacturer}", f.manufacturer ?? "")
    .replaceAll("{category}", f.categoryName ?? "")
    .replaceAll("{supplier}", f.supplierName ?? "");

/**
 * Опис і характеристики в картці товару.
 * Для нового товару: щойно обрали категорію — підставляється шаблон цієї категорії (якщо поля ще не редагували).
 */
export default function DetailsFields({
  description,
  descriptionTranslate = null,
  keywords = null,
  keywordsUa = null,
  params,
  templates,
  isNew,
  notLoaded,
}: {
  description: string | null;
  descriptionTranslate?: string | null;
  keywords?: string | null;
  keywordsUa?: string | null;
  params: Param[];
  templates: ClientTemplate[];
  isNew: boolean;
  notLoaded: boolean; // опис/характеристики не завантажені з SalesDrive (вимкнено в YML)
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [desc, setDesc] = useState(description ?? "");
  const [descTr, setDescTr] = useState(descriptionTranslate ?? "");
  const [kw, setKw] = useState(keywords ?? "");
  const [kwUa, setKwUa] = useState(keywordsUa ?? "");
  const [rows, setRows] = useState<Param[]>(params);
  const [touched, setTouched] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const formValues = () => {
    const form = ref.current?.closest("form");
    const v: Record<string, string> = {};
    if (!form) return v;
    for (const n of ["name", "nameTranslate", "sku", "barcode", "manufacturer", "categoryName", "supplierName", "country"]) {
      const el = form.elements.namedItem(n) as HTMLInputElement | null;
      v[n] = el?.value ?? "";
    }
    return v;
  };

  const pick = (category: string) =>
    templates.find((t) => t.categoryName && t.categoryName.toLowerCase() === category.toLowerCase()) ?? templates.find((t) => !t.categoryName) ?? null;

  const apply = (force: boolean) => {
    const f = formValues();
    const t = pick(f.categoryName ?? "");
    if (!t) return setInfo("Для цієї категорії немає шаблону. Створіть його в «Шаблони опису».");
    if (t.description && (force || !desc.trim())) setDesc(render(t.description, f));
    if (t.descriptionTranslate && (force || !descTr.trim())) setDescTr(render(t.descriptionTranslate, { ...f, name: f.nameTranslate || f.name }));
    let k = kw;
    if (t.keywords && (force || !kw.trim())) setKw((k = render(t.keywords, f)));
    if (force || !kwUa.trim()) {
      if (t.keywordsUa) setKwUa(render(t.keywordsUa, { ...f, name: f.nameTranslate || f.name }));
      else if (k) setKwUa(translateKeywords(k));
    }
    // країна за замовчуванням з шаблону
    const form = ref.current?.closest("form");
    const c = form?.elements.namedItem("country") as HTMLInputElement | null;
    if (c && t.country && (force || !c.value)) c.value = t.country;
    const merged = [...rows.filter((r) => r.name.trim())];
    for (const tp of t.params) if (!merged.some((r) => r.name.toLowerCase() === tp.name.toLowerCase())) merged.push({ ...tp, value: render(tp.value, f) });
    setRows(merged);
    setInfo(`Застосовано шаблон «${t.name}»`);
  };

  // Автопідстановка для нового товару при виборі категорії
  useEffect(() => {
    if (!isNew) return;
    const form = ref.current?.closest("form");
    if (!form) return;
    const h = (e: Event) => {
      const el = e.target as HTMLInputElement;
      if (el.name === "categoryName" && !touched) apply(false);
    };
    form.addEventListener("change", h);
    if (!touched && !desc && !rows.length) apply(false); // загальний шаблон одразу
    return () => form.removeEventListener("change", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, touched, templates]);

  return (
    <div ref={ref} style={{ gridColumn: "1 / -1", display: "grid", gap: 12 }}>
      {notLoaded && (
        <div className="msg warn small">
          Опис і характеристики цього товару не завантажені з SalesDrive. Увімкніть у YML-експорті «Експортувати опис, фото та характеристики» і
          синхронізуйтесь — інакше збережений тут опис замінить той, що є в CRM.
        </div>
      )}
      <label>
        Опис російською (RU; можна HTML)
        <textarea
          name="description"
          rows={6}
          value={desc}
          onChange={(e) => {
            setDesc(e.target.value);
            setTouched(true);
          }}
        />
      </label>
      <label>
        <span className="row" style={{ justifyContent: "space-between" }}>
          <span>Опис українською (UA) — порожньо: такий самий, як російський</span>
          <button type="button" className="btn sm" onClick={() => setDescTr(desc)} disabled={!desc}>
            скопіювати з RU
          </button>
        </span>
        <textarea name="descriptionTranslate" rows={4} value={descTr} onChange={(e) => setDescTr(e.target.value)} />
      </label>
      <label>
        Пошукові запити RU (через кому)
        <input name="keywords" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="колодки на мотоцикл, тормозные колодки Lifan…" />
      </label>
      <label>
        <span className="row" style={{ justifyContent: "space-between" }}>
          <span>Пошукові запити UA</span>
          <button type="button" className="btn sm" onClick={() => setKwUa(translateKeywords(kw))} disabled={!kw}>
            перекласти з RU
          </button>
        </span>
        <input name="keywordsUa" value={kwUa} onChange={(e) => setKwUa(e.target.value)} placeholder="колодки на мотоцикл, гальмівні колодки Lifan…" />
      </label>
      <div>
        <div className="toolbar" style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Характеристики</span>
          <button type="button" className="btn sm" onClick={() => apply(true)}>
            Підставити з шаблону
          </button>
          {info && <span className="muted small">{info}</span>}
        </div>
        <ParamsEditor
          name="params"
          value={rows}
          onChange={(p) => {
            setRows(p);
            setTouched(true);
          }}
        />
      </div>
    </div>
  );
}
