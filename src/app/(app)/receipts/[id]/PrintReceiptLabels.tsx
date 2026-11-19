"use client";

import PrintButton from "@/components/PrintButton";
import TemplateSelect, { useTemplate } from "@/components/TemplateSelect";

/** Кнопка «надрукувати цінники на все, що надійшло» (кількість = кількість у приході) */
export default function PrintReceiptLabels({ receiptId, highlight }: { receiptId: number; highlight?: boolean }) {
  const [tpl, setTpl] = useTemplate();
  return (
    <div className={highlight ? "msg ok toolbar" : "toolbar"}>
      {highlight && <span>Прихід проведено. Надрукувати цінники на весь товар?</span>}
      <TemplateSelect value={tpl} onChange={setTpl} />
      <PrintButton className="btn primary" href={`/print/labels?receipt=${receiptId}&tpl=${tpl}`}>
        🖨 Цінники на прихід
      </PrintButton>
      <PrintButton className="btn" href={`/print/labels?receipt=${receiptId}&tpl=${tpl}&one=1`}>
        По одному на товар
      </PrintButton>
    </div>
  );
}
