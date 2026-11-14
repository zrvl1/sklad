import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import ProductTable from "./ProductTable";

const PAGE = 50;

type SP = Promise<{ q?: string; page?: string; print?: string; nobarcode?: string; errors?: string }>;

export default async function ProductsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.ProductWhereInput = {};
  if (q) where.OR = [{ search: { contains: q } }, { barcode: q }];
  if (sp.nobarcode) where.AND = [{ OR: [{ barcode: null }, { barcode: "" }] }];
  if (sp.errors) where.syncError = { not: null };

  const [total, products] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { stocks: true, cells: { include: { cell: true } } },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => {
    const s = new URLSearchParams();
    if (sp.q) s.set("q", sp.q);
    if (sp.print) s.set("print", "1");
    if (sp.nobarcode) s.set("nobarcode", "1");
    if (sp.errors) s.set("errors", "1");
    s.set("page", String(p));
    return `?${s}`;
  };

  return (
    <>
      <h1>{sp.print ? "Друк цінників" : "Товари"}</h1>
      <form className="toolbar">
        <input name="q" defaultValue={sp.q} placeholder="Назва, SKU, штрихкод, ID…" style={{ width: 340 }} autoFocus />
        {sp.print && <input type="hidden" name="print" value="1" />}
        <button className="btn">Знайти</button>
        <span className="spacer" />
        <Link className="btn primary" href="/products/new">
          + Новий товар
        </Link>
      </form>
      {sp.print && <p className="muted small">Позначте товари, вкажіть кількість цінників і натисніть «Друкувати».</p>}

      <ProductTable
        products={products.map((p) => ({
          id: p.id,
          sdId: p.sdId,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          price: p.price,
          cost: p.cost,
          stock: p.stocks.reduce((s, x) => s + x.qty, 0),
          cells: p.cells.map((c) => c.cell.code).join(", "),
          syncError: p.syncError,
        }))}
      />

      <div className="pager">
        {page > 1 && (
          <Link className="btn sm" href={qs(page - 1)}>
            ← Назад
          </Link>
        )}
        <span className="muted small">
          Сторінка {page} з {pages} · знайдено {total}
        </span>
        {page < pages && (
          <Link className="btn sm" href={qs(page + 1)}>
            Далі →
          </Link>
        )}
      </div>
    </>
  );
}
