"use client";

import { useMemo, useState } from "react";
import CategoryTreeSelect, { type TreeOpt } from "./CategoryTreeSelect";

type Opt = TreeOpt;

/** Вибір категорії SalesDrive: наявна (зі шляхом) або нова — тоді обрати батьківську, і її буде створено в SalesDrive */
export default function CategoryPicker({ options, extraNames = [], initial }: { options: Opt[]; extraNames?: string[]; initial: string }) {
  const [v, setV] = useState(initial);
  const val = v.trim();
  const match = useMemo(() => {
    if (!val) return null;
    const byPath = options.find((o) => o.path === val);
    if (byPath) return byPath;
    const byName = options.filter((o) => o.name === val);
    return byName.length === 1 ? byName[0] : byName.length > 1 ? "many" : null;
  }, [val, options]);
  const known = extraNames.includes(val);
  return (
    <label>
      Категорія
      <CategoryTreeSelect options={options} name="categoryPath" mode="path" allowFree value={v} onChange={(x) => setV(x)} placeholder="почніть вводити назву або оберіть у дереві" />
      {val && match && match !== "many" && <span className="small" style={{ color: "#15803d" }}>✓ є в SalesDrive: {match.path}</span>}
      {val && match === "many" && <span className="small" style={{ color: "#b45309" }}>Таких категорій кілька — оберіть зі списку повний шлях</span>}
      {val && !match && known && <span className="small muted">Категорія є в товарах, але її ID у SalesDrive невідомий — передасться за назвою</span>}
      {val && !match && !known && (
        <span className="small" style={{ display: "block", marginTop: 4 }}>
          <span style={{ color: "#1d4ed8" }}>＋ Нова категорія — буде створена в SalesDrive у розділі:</span>
          <CategoryTreeSelect options={options} name="categoryParent" mode="id" emptyLabel="— верхній рівень —" placeholder="— верхній рівень —" style={{ marginTop: 4 }} />
        </span>
      )}
    </label>
  );
}
