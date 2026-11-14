import { productFormContext } from "@/lib/templates";
import ProductForm from "../ProductForm";

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  const ctx = await productFormContext();
  return (
    <>
      <h1>Новий товар</h1>
      {err && <div className="msg err">{err}</div>}
      <p className="muted small">
        Оберіть категорію — опис і характеристики підставляться з шаблону. Артикул і штрихкод згенеруються автоматично, якщо не вписати свої.
      </p>
      <ProductForm {...ctx} />
    </>
  );
}
