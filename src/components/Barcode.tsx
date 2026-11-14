"use client";

import JsBarcode from "jsbarcode";
import { useEffect, useRef } from "react";
import { barcodeFormat } from "@/lib/barcode";

export default function Barcode({ value, height, fontSize = 10, width = 1.4 }: { value: string; height: number; fontSize?: number; width?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: barcodeFormat(value),
        height,
        width,
        fontSize,
        margin: 0,
        textMargin: 1,
        displayValue: fontSize > 0,
      });
    } catch {
      // некоректний код для формату — друкуємо як CODE128
      try {
        JsBarcode(ref.current, value, { format: "CODE128", height, width, fontSize, margin: 0, textMargin: 1, displayValue: fontSize > 0 });
      } catch {}
    }
  }, [value, height, fontSize, width]);
  // crispEdges — чіткі смуги на термопринтері без розмиття
  return <svg ref={ref} shapeRendering="crispEdges" style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }} />;
}
