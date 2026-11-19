"use client";

import JsBarcode from "jsbarcode";
import { useEffect, useRef } from "react";
import { barcodeFormat } from "@/lib/barcode";

/**
 * Штрихкод у міліметрах, без масштабування браузером.
 * moduleMm — ширина найтоншої смуги: 0.25 мм = рівно 2 точки термопринтера 203 dpi (XP-235B), 0.375 = 3 точки.
 * Цілі точки — чіткі смуги, які сканер читає з першого разу.
 */
export default function Barcode({ value, moduleMm = 0.25, barMm = 8, textMm = 2 }: { value: string; moduleMm?: number; barMm?: number; textMm?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg || !value) return;
    const U = 10; // одиниць SVG на модуль
    const opts = { width: U, height: Math.round((barMm / moduleMm) * U), fontSize: Math.round((textMm / moduleMm) * U), margin: 0, textMargin: Math.round(U * 1.5), displayValue: textMm > 0, font: "Arial", fontOptions: "bold" };
    try {
      JsBarcode(svg, value, { ...opts, format: barcodeFormat(value) });
    } catch {
      try {
        JsBarcode(svg, value, { ...opts, format: "CODE128" });
      } catch {}
    }
    // розмір у мм: ширина в одиницях / U × ширина модуля
    const w = Number(svg.getAttribute("width")) || 0;
    const h = Number(svg.getAttribute("height")) || 0;
    if (w && h) {
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.style.width = `${(w / U) * moduleMm}mm`;
      svg.style.height = `${(h / U) * moduleMm}mm`;
    }
  }, [value, moduleMm, barMm, textMm]);
  // crispEdges — без згладжування країв смуг
  return <svg ref={ref} shapeRendering="crispEdges" style={{ display: "block", margin: "0 auto" }} />;
}
