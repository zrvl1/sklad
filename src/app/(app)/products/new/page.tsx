import { productFormContext } from "@/lib/templates";
import ProductForm from "../ProductForm";
import { nextSku } from "@/lib/nextcodes";

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  const [ctx, suggestedSku] = await Promise.all([productFormContext(), nextSku()]);
  return (
    <>
      <h1>Новий товар</h1>
      {err && <div className="msg err">{err}</div>}
      <p className="muted small">
        Артикул уже підставлено наступний за порядком. Штрихкод: відскануйте заводський або натисніть «створити». Оберіть категорію — опис і
        характеристики підставляться з шаблону.
      </p>
      <ProductForm {...ctx} suggestedSku={suggestedSku} />
    </>
  );
}
