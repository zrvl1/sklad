import { db } from "@/lib/db";
import ProductForm from "../ProductForm";

export default async function NewProductPage() {
  const [suppliers, currencies] = await Promise.all([db.supplier.findMany({ orderBy: { name: "asc" } }), db.currency.findMany()]);
  return (
    <>
      <h1>Новий товар</h1>
      <ProductForm suppliers={suppliers} currencies={currencies.map((c) => c.code)} />
    </>
  );
}
