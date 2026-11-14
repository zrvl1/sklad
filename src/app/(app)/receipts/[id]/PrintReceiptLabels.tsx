"use client";

import TemplateSelect, { useTemplate } from "@/components/TemplateSelect";

/** Кнопка «надрукувати цінники на все, що надійшло» (кількість = кількість у приході) */
export default function PrintReceiptLabels({ receiptId, highlight }: { receiptId: number; highlight?: boolean }) {
  const [tpl, setTpl] = useTemplate();
  return (
    <div className={highlight ? "msg ok toolbar" : "toolbar"}>
      {highlight && <span>Прихід проведено. Надрукувати цінники на весь товар?</span>}
      <TemplateSelect value={tpl} onChange={setTpl} />
      <a className="btn primary" href={`/print/labels?receipt=${receiptId}&tpl=${tpl}`} target="_blank">
        🖨 Цінники на прихід
      </a>
      <a className="btn" href={`/print/labels?receipt=${receiptId}&tpl=${tpl}&one=1`} target="_blank">
        По одному на товар
      </a>
    </div>
  );
}
