import type { Product, Supplier } from "@prisma/client";
import { dateInput } from "@/lib/util";
import { parseParams } from "@/lib/salesdrive";
import DetailsFields, { type ClientTemplate } from "@/components/DetailsFields";
import CodeInput from "@/components/CodeInput";
import NameTranslate from "@/components/NameTranslate";
import { saveProduct } from "./actions";
import { isAppSdId } from "@/lib/sdid";
import CategoryPicker from "@/components/CategoryPicker";
import type { CatOption } from "@/lib/categories";

export default function ProductForm({
  product,
  suppliers,
  templates = [],
  categories = [],
  catOptions = [],
  currencies = ["UAH"],
  showCurrency = false,
  kitsCount = 0,
  suggestedSku = null,
}: {
  suggestedSku?: string | null;
  kitsCount?: number;
  product?: Product | null;
  suppliers: Supplier[];
  templates?: ClientTemplate[];
  categories?: string[];
  catOptions?: CatOption[];
  currencies?: string[];
  showCurrency?: boolean;
}) {
  const p = product;
  const foreignCost = showCurrency && p?.costCurrency && p.costCurrency !== "UAH";
  return (
    <form action={saveProduct} className="panel">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="grid2">
        <label style={{ gridColumn: "1 / -1" }}>
          Назва російською (RU, основна в SalesDrive) *
          <input name="name" defaultValue={p?.name} required minLength={2} maxLength={255} autoFocus={!p} />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          <span className="row" style={{ justifyContent: "space-between" }}>
            <span>Назва українською (UA)</span>
            <NameTranslate />
          </span>
          <input name="nameTranslate" defaultValue={p?.nameTranslate ?? ""} maxLength={255} placeholder="порожньо — перекладеться автоматично при збереженні" />
        </label>
        <CategoryPicker
          options={catOptions}
          extraNames={categories}
          initial={(p?.categorySdId && catOptions.find((c) => c.id === p.categorySdId)?.path) || p?.categoryName || ""}
        />
        <label>
          Назва для документів
          <input name="nameForDocuments" defaultValue={p?.nameForDocuments ?? ""} />
        </label>
        <label>
          Ціна продажу, грн
          <input name="price" type="number" min={0} step="0.01" defaultValue={p?.price ?? ""} />
        </label>
        <label>
          Собівартість{showCurrency ? "" : ", грн"}
          <span className="row" style={{ gap: 6 }}>
            <input name="cost" type="number" min={0} step="0.01" defaultValue={foreignCost ? p?.costOriginal ?? "" : p?.cost ?? ""} style={{ width: 140 }} />
            {showCurrency ? (
              <select name="costCurrency" defaultValue={p?.costCurrency ?? "UAH"}>
                {[...new Set(["UAH", ...currencies])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input type="hidden" name="costCurrency" value="UAH" />
            )}
            {foreignCost && <span className="muted small">= {p?.cost} грн</span>}
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
          <input name="supplierName" list="suppliers" defaultValue={p?.supplierName ?? ""} autoComplete="off" />
          <datalist id="suppliers">
            {suppliers.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </label>
        <label>
          Бренд (виробник запчастини)
          <input name="manufacturer" defaultValue={p?.manufacturer ?? ""} />
        </label>
        <label>
          Країна виробник
          <input name="country" list="countries-pf" defaultValue={p ? (p.country ?? "") : "Китай"} placeholder="Китай" />
          <datalist id="countries-pf">
            {["Китай", "Індія", "Тайвань", "Японія", "Італія", "Україна", "Польща"].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label>
          Артикул (SKU)
          <CodeInput name="sku" kind="sku" defaultValue={p ? p.sku : suggestedSku} productId={p?.id} placeholder="свій або «наступний»" generate />
        </label>
        <label>
          Штрихкод
          <CodeInput name="barcode" kind="barcode" defaultValue={p?.barcode} productId={p?.id} placeholder="штрихкод постачальника або «створити»" generate />
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

        <DetailsFields
          description={p?.description ?? null}
          descriptionTranslate={p?.descriptionTranslate ?? null}
          keywords={p?.keywords ?? null}
          keywordsUa={p?.keywordsUa ?? null}
          params={
            p
              ? parseParams(p.params)
              : [
                  { name: "Стан", type: "text", value: "Новий" },
                  { name: "Тип запчастини", type: "text", value: "Оригінал" },
                ]
          }
          templates={[]}
          isNew={!p}
          notLoaded={Boolean(p && p.description === null && p.params === null && p.sdId && !isAppSdId(p.sdId))}
        />
      </div>
      <div className="toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
        <button className="btn primary">Зберегти і відправити в SalesDrive</button>
        {!p && (
          <label className="check small">
            <input type="checkbox" name="thenCards" /> далі — створити картки-комплекти під моделі
          </label>
        )}
        {kitsCount > 0 && (
          <label className="check small">
            <input type="checkbox" name="applyKits" defaultChecked /> нову ціну — на всі картки-комплекти ({kitsCount})
          </label>
        )}
        <span className="muted small">Відправляються лише змінені назва, ціна, собівартість, опис і характеристики.</span>
      </div>
    </form>
  );
}
