"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteProducts } from "./actions";
import TemplateSelect, { useTemplate } from "@/components/TemplateSelect";

type Row = {
  id: number;
  sdId: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  cost: number;
  stock: number;
  cells: string;
  syncError: string | null;
};

const fmt = (v: number) => v.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProductTable({ products }: { products: Row[] }) {
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [tpl, setTpl] = useTemplate();
  const count = Object.keys(selected).length;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const remove = () => {
    const ids = Object.keys(selected).map(Number);
    const reason = prompt(`Видалити ${ids.length} товар(и) у SalesDrive і в додатку?\nВкажіть причину (необов'язково) і натисніть OK.`);
    if (reason === null) return;
    start(async () => {
      const r = await deleteProducts(ids, reason);
      if (!r.ok) return setErr(r.error);
      setSelected({});
      setErr(null);
      router.refresh();
    });
  };

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = { ...s };
      if (n[id]) delete n[id];
      else n[id] = 1;
      return n;
    });

  const toggleAll = () =>
    setSelected((s) => (Object.keys(s).length === products.length ? {} : Object.fromEntries(products.map((p) => [p.id, s[p.id] ?? 1]))));

  const print = () => {
    const items = Object.entries(selected)
      .map(([id, q]) => `${id}:${q}`)
      .join(",");
    window.open(`/print/labels?items=${items}&tpl=${tpl}`, "_blank");
  };

  return (
    <>
      <div className="toolbar">
        <TemplateSelect value={tpl} onChange={setTpl} />
        <button className="btn primary" disabled={!count} onClick={print}>
          🖨 Друкувати цінники ({Object.values(selected).reduce((a, b) => a + b, 0)})
        </button>
        <span className="spacer" />
        <button className="btn danger" disabled={!count || pending} onClick={remove}>
          Видалити вибрані ({count})
        </button>
      </div>
      {err && <div className="msg err">{err}</div>}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 30 }}>
                <input type="checkbox" checked={count > 0 && count === products.length} onChange={toggleAll} />
              </th>
              <th>Назва</th>
              <th>SKU</th>
              <th>Штрихкод</th>
              <th>Комірки</th>
              <th className="num">Залишок</th>
              <th className="num">Собівартість</th>
              <th className="num">Ціна</th>
              <th style={{ width: 90 }}>Цінників</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  <input type="checkbox" checked={!!selected[p.id]} onChange={() => toggle(p.id)} />
                </td>
                <td>
                  <Link href={`/products/${p.id}`}>{p.name}</Link>
                  {p.syncError && (
                    <span className="badge err" title={p.syncError} style={{ marginLeft: 6 }}>
                      не в CRM
                    </span>
                  )}
                  <div className="muted small">ID {p.sdId ?? "—"}</div>
                </td>
                <td>{p.sku}</td>
                <td>{p.barcode ?? <span className="badge warn">немає</span>}</td>
                <td>{p.cells || <span className="muted">—</span>}</td>
                <td className="num">{p.stock}</td>
                <td className="num">{fmt(p.cost)}</td>
                <td className="num">
                  <b>{fmt(p.price)}</b>
                </td>
                <td>
                  <input
                    className="short"
                    type="number"
                    min={0}
                    value={selected[p.id] ?? ""}
                    placeholder="0"
                    onChange={(e) =>
                      setSelected((s) => {
                        const n = { ...s };
                        const v = Math.max(0, parseInt(e.target.value) || 0);
                        if (v) n[p.id] = v;
                        else delete n[p.id];
                        return n;
                      })
                    }
                  />
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  Нічого не знайдено. Якщо база порожня — зробіть синхронізацію в Налаштуваннях.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
