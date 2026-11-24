"use client";

import CategoryTreeSelect, { type TreeOpt } from "./CategoryTreeSelect";

/** Таблиця «категорія фіду → категорія сайту» (дерево категорій передається один раз) */
export default function FeedCategoryTable({ rows, options }: { rows: { name: string; count: number; value: string }[]; options: TreeOpt[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Категорія у фіді</th>
          <th>Товарів</th>
          <th style={{ minWidth: 340 }}>Категорія на сайті</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td>{r.name}</td>
            <td>{r.count}</td>
            <td>
              <CategoryTreeSelect options={options} name={`fc:${r.name}`} mode="path" defaultValue={r.value} placeholder="не зіставлено" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
