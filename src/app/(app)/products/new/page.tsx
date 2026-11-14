import { db } from "@/lib/db";
import ProductForm from "../ProductForm";

export default async function NewProductPage() {
  const suppliers = await db.supplier.findMany({ orderBy: { name: "asc" } });
  return (
    <>
      <h1>Новий товар</h1>
      <ProductForm suppliers={suppliers} />
    </>
  );
}
