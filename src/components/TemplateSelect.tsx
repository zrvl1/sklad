"use client";

import { useEffect, useState } from "react";
import { LABEL_TEMPLATES, type TemplateId } from "@/lib/labels";

const KEY = "labelTemplate";

/** Запам'ятовує обраний шаблон цінника у браузері */
export function useTemplate(): [TemplateId, (t: TemplateId) => void] {
  const [tpl, setTpl] = useState<TemplateId>("58x40");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as TemplateId | null;
      if (saved && saved in LABEL_TEMPLATES) setTpl(saved);
    } catch {}
  }, []);
  const set = (t: TemplateId) => {
    setTpl(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {}
  };
  return [tpl, set];
}

export default function TemplateSelect({ value, onChange }: { value: TemplateId; onChange: (t: TemplateId) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as TemplateId)}>
      {Object.entries(LABEL_TEMPLATES).map(([id, t]) => (
        <option key={id} value={id}>
          {t.title}
        </option>
      ))}
    </select>
  );
}
