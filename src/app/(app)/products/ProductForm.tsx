import type { Product, Supplier } from "@prisma/client";
import { dateInput } from "@/lib/util";
import { saveProduct } from "./actions";

export default function ProductForm({
  product,
  suppliers,
  currencies = ["UAH"],
}: {
  product?: Product | null;
  suppliers: Supplier[];
  currencies?: string[];
}) {
  const p = product;
  return (
    <form action={saveProduct} className="panel">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="grid2">
        <label style={{ gridColumn: "1 / -1" }}>
          Назва *
          <input name="name" defaultValue={p?.name} required autoFocus={!p} />
        </label>
        <label>
          Назва для документів
          <input name="nameForDocuments" defaultValue={p?.nameForDocuments ?? ""} />
        </label>
        <label>
          Категорія
          <input name="categoryName" defaultValue={p?.categoryName ?? ""} placeholder="як у SalesDrive" />
        </label>
        <label>
          Ціна продажу{p?.priceCurrency && p.priceCurrency !== "UAH" ? `, ${p.priceCurrency}` : ", грн"}
          <input name="price" inputMode="decimal" defaultValue={p?.price ?? ""} />
        </label>
        <label>
          Собівартість
          <span className="row" style={{ gap: 6 }}>
            <input
              name="cost"
              inputMode="decimal"
              defaultValue={p?.costCurrency && p.costCurrency !== "UAH" ? p.costOriginal ?? "" : p?.cost ?? ""}
              style={{ width: 120 }}
            />
            <select name="costCurrency" defaultValue={p?.costCurrency ?? "UAH"}>
              {[...new Set(["UAH", ...currencies])].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {p?.costCurrency && p.costCurrency !== "UAH" && <span className="muted small">= {p.cost} грн</span>}
          </span>
        </label>
        <label>
          Знижка
          <span className="row" style={{ gap: 6 }}>
            <input name="discountValue" inputMode="decimal" defaultValue={p?.discountValue ?? ""} style={{ width: 90 }} />
            <select name="discountType" defaultValue={p?.discountType ?? "percent"}>
              <option value="percent">%</option>
              <option value="amount">грн</option>
            </select>
          </span>
        </label>
        <label>
          Період знижки
          <span className="row" style={{ gap: 6 }}>
            <input type="date" name="discountFrom" defaultValue={dateInput(p?.discountFrom)} />
            <input type="date" name="discountTo" defaultValue={dateInput(p?.discountTo)} />
          </span>
        </label>
        <label>
          Постачальник
          <input name="supplierName" list="suppliers" defaultValue={p?.supplierName ?? ""} />
          <datalist id="suppliers">
            {suppliers.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </label>
        <label>
          Виробник
          <input name="manufacturer" defaultValue={p?.manufacturer ?? ""} />
        </label>
        <label>
          Артикул (SKU)
          <input name="sku" defaultValue={p?.sku ?? ""} />
        </label>
        <label>
          Штрихкод
          <input name="barcode" defaultValue={p?.barcode ?? ""} placeholder="відскануйте або залиште порожнім" />
        </label>
        <label>
          ID у SalesDrive
          <input name="sdId" defaultValue={p?.sdId ?? ""} placeholder="заповниться автоматично" readOnly={!!p?.sdId} />
        </label>
        <div style={{ alignSelf: "end", display: "grid", gap: 6 }}>
          <label className="check">
            <input type="checkbox" name="genBarcode" defaultChecked={!p?.barcode} />
            Згенерувати штрихкод, якщо порожній
          </label>
          <label className="check">
            <input type="checkbox" name="genSku" defaultChecked={!p} />
            Згенерувати артикул, якщо порожній
          </label>
        </div>
        <label>
          Артикул постачальника (додати)
          <input name="supplierCode" placeholder="код із накладної постачальника" />
        </label>
        <label>
          Постачальник цього артикула
          <select name="supplierCodeSupplierId" defaultValue="">
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
        <button className="btn primary">Зберегти і відправити в SalesDrive</button>
      </div>
    </form>
  );
}
