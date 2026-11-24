"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createFromSupplierItem } from "@/app/(app)/products/actions";

export type FeedProduct = { id: number; name: string; sku: string | null; barcode: string | null; price: number; cost: number; sdId?: string | null };

/** Кнопка «Створити товар з фіду»: категорія (з підказками), далі все інше береться з XML постачальника */
export default function CreateFromFeed({
  supplierId,
  code,
  categoryPaths,
  defaultCategory,
  cost,
  costCurrency,
  onCreated,
  compact = false,
}: {
  supplierId: number;
  code: string;
  categoryPaths: string[];
  defaultCategory: string;
  cost?: number;
  costCurrency?: string;
  onCreated?: (p: FeedProduct, note: string | null) => void;
  compact?: boolean;
}) {
  const [cat, setCat] = useState(defaultCategory);
  const [res, setRes] = useState<{ ok: boolean; text: string; id?: number } | null>(null);
  const [pending, start] = useTransition();
  const listId = `cats-${supplierId}`;
  const known = categoryPaths.includes(cat) || categoryPaths.some((p) => p.endsWith(` › ${cat}`) || p === cat);

  if (res?.ok && res.id)
    return (
      <span className="small">
        ✓ <Link href={`/products/${res.id}`}>створено</Link> <span className="muted">{res.text}</span>
      </span>
    );

  return (
    <span className="row" style={{ gap: 6, flexWrap: compact ? "nowrap" : "wrap" }}>
      <input
        list={listId}
        value={cat}
        onChange={(e) => setCat(e.target.value)}
        placeholder="Категорія на сайті"
        style={{ minWidth: 220, borderColor: cat && !known ? "#b45309" : undefined }}
        title={cat && !known ? "Такої категорії немає в SalesDrive — оберіть зі списку" : undefined}
      />
      <datalist id={listId}>
        {categoryPaths.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <button
        type="button"
        className="btn sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await createFromSupplierItem({ supplierId, code, categoryName: cat || undefined, cost, costCurrency });
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
