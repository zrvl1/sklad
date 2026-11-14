"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { LABEL_TEMPLATES } from "@/lib/labels";

/** Панель над цінниками: вибір шаблону і кнопка друку. На папері не друкується. */
export default function PrintToolbar({ count, showTemplates = true }: { count: number; showTemplates?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  useEffect(() => {
    if (sp.get("auto") === "1") {
      const t = setTimeout(() => window.print(), 400); // даємо штрихкодам відмалюватися
      return () => clearTimeout(t);
    }
  }, [sp]);

  const setTpl = (tpl: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set("tpl", tpl);
    try {
      localStorage.setItem("labelTemplate", tpl);
    } catch {}
    router.replace(`${pathname}?${next}`);
  };

  return (
    <div className="no-print toolbar" style={{ padding: 12, background: "#fff", borderBottom: "1px solid #e2e5eb", position: "sticky", top: 0, zIndex: 2 }}>
      <b>Етикеток: {count}</b>
      {showTemplates && (
        <select value={sp.get("tpl") ?? "58x40"} onChange={(e) => setTpl(e.target.value)}>
          {Object.entries(LABEL_TEMPLATES).map(([id, t]) => (
            <option key={id} value={id}>
              {t.title}
            </option>
          ))}
        </select>
      )}
      <button className="btn primary" onClick={() => window.print()}>
        🖨 Друкувати
      </button>
      <span className="muted small">
        У вікні друку оберіть принтер етикеток, масштаб 100%, поля «Немає». Для друку без діалогу запускайте Chrome з ключем --kiosk-printing.
      </span>
    </div>
  );
}
