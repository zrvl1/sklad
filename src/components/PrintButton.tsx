"use client";

import type { ReactNode } from "react";

/**
 * Друк етикеток без відкриття нової вкладки: сторінка друку вантажиться в прихованому фреймі й сама викликає друк.
 * Якщо Chrome запущено з ключем --kiosk-printing — друкує одразу на принтер за замовчуванням, без вікна друку.
 */
export function printUrl(href: string) {
  const url = `${href}${href.includes("?") ? "&" : "?"}auto=1`;
  document.getElementById("print-frame")?.remove();
  const f = document.createElement("iframe");
  f.id = "print-frame";
  f.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;";
  f.src = url;
  document.body.appendChild(f);
  // фрейм прибираємо згодом (друк уже в черзі)
  setTimeout(() => f.remove(), 120_000);
}

export default function PrintButton({ href, className = "btn", title, children }: { href: string; className?: string; title?: string; children?: ReactNode }) {
  return (
    <button type="button" className={className} title={title} onClick={() => printUrl(href)}>
      {children}
    </button>
  );
}
