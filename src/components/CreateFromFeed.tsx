"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createFromSupplierItem } from "@/app/(app)/products/actions";
import CategoryTreeSelect, { type TreeOpt } from "./CategoryTreeSelect";

export type FeedProduct = { id: number; name: string; sku: string | null; barcode: string | null; price: number; cost: number; sdId?: string | null };

/** Кнопка «Створити товар з фіду»: категорія (з підказками), далі все інше береться з XML постачальника */
export default function CreateFromFeed({
  supplierId,
  code,
  categoryOptions,
  defaultCategory,
  cost,
  costCurrency,
  onCreated,
  compact = false,
}: {
  supplierId: number;
  code: string;
  categoryOptions: TreeOpt[];
  defaultCategory: string;
  cost?: number;
  costCurrency?: string;
  onCreated?: (p: FeedProduct, note: string | null) => void;
  compact?: boolean;
}) {
  const [cat, setCat] = useState(defaultCategory);
  const [name, setName] = useState("");
  const [nameRu, setNameRu] = useState("");
  const [res, setRes] = useState<{ ok: boolean; text: string; id?: number } | null>(null);
  const [pending, start] = useTransition();

  if (res?.ok && res.id)
    return (
      <span className="small">
        ✓ <Link href={`/products/${res.id}`}>створено</Link> <span className="muted">{res.text}</span>
      </span>
    );

  return (
    <span className="row" style={{ gap: 6, flexWrap: compact ? "nowrap" : "wrap" }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Фінальна назва UA (обов'язково)"
        title="Хорошоп бере назву лише при створенні товару і потім її не оновлює — вписуйте одразу остаточну"
        style={{ minWidth: 320, borderColor: name.trim() ? undefined : "#f59e0b" }}
      />
      <input
        value={nameRu}
        onChange={(e) => setNameRu(e.target.value)}
        placeholder="Назва RU (порожньо — перекладе DeepL)"
        style={{ minWidth: 280 }}
      />
      <CategoryTreeSelect options={categoryOptions} mode="path" value={cat} onChange={(v) => setCat(v)} placeholder="Категорія на сайті" style={{ minWidth: 260 }} />
      <button
        type="button"
        className="btn sm"
        disabled={pending || !name.trim()}
        title={name.trim() ? undefined : "Спершу впишіть фінальну назву UA"}
        onClick={() =>
          start(async () => {
            const r = await createFromSupplierItem({ supplierId, code, name: name.trim(), nameRu: nameRu.trim() || undefined, categoryName: cat || undefined, cost, costCurrency });
            if (!r.ok) return setRes({ ok: false, text: r.error });
            setRes({ ok: true, text: r.warning ?? "", id: r.product.id });
            onCreated?.(r.product, r.warning);
          })
        }
      >
        {pending ? "Створюю… (фото)" : "Створити товар з XML"}
      </button>
      {res && !res.ok && <span className="small" style={{ color: "#b91c1c" }}>{res.text}</span>}
    </span>
  );
}
