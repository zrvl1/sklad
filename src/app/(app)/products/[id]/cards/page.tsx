import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { parseParams } from "@/lib/salesdrive";
import CardsForm from "./CardsForm";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; warn?: string; saved?: string }> };

// Створення карток-комплектів (вітрин під різні моделі) для основного товару
export default async function KitCardsPage({ params, searchParams }: Props) {
  await requirePerm("products.edit");
  const { id } = await params;
  const { err, warn, saved } = await searchParams;
  const base = await db.product.findUnique({
    where: { id: Number(id) },
    include: { kits: { where: { deletedAt: null }, orderBy: { sku: "asc" } } },
  });
  if (!base || base.deletedAt) notFound();
  if (base.baseProductId) redirect(`/products/${base.baseProductId}/cards`);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Картки-комплекти</h1>
        <span className="spacer" />
        <Link className="btn" href={`/products/${base.id}`}>
          До товару
        </Link>
      </div>
      {saved === "1" && <div className="msg ok">Основний товар збережено й відправлено в SalesDrive. Тепер — картки під моделі.</div>}
      {saved === "0" && <div className="msg warn">Основний товар збережено, але не відправлено в SalesDrive — перевірте на його сторінці.</div>}
      {warn && <div className="msg warn">{warn}</div>}
      {err && <div className="msg err">{err}</div>}

      <div className="panel small">
        Основний товар: <Link href={`/products/${base.id}`}><b>{base.name}</b></Link> · {base.sku ?? <span className="badge err">немає артикула</span>} · {base.price} грн
        {base.kits.length > 0 && (
          <div style={{ marginTop: 6 }}>
            Уже є картки:{" "}
            {base.kits.map((k) => (
              <span key={k.id} className="badge" style={{ marginRight: 4 }}>
                {k.sku}
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="muted small">
        Кожна картка створиться в SalesDrive як окремий товар зі своєю назвою (обидві мови), описом, характеристиками, штрихкодом і артикулом{" "}
        <b>{base.sku ?? "АРТИКУЛ"}-N</b>. Характеристики основного копіюються в кожну картку, свої — додаються зверху. Після створення в SalesDrive
        треба відкрити кожну картку, поставити галочку <b>«Комплект»</b> і додати основний товар — API цього не вміє. Поки цього не зроблено, картка
        висить у списку «Налаштувати в SalesDrive».
      </p>

      <CardsForm
        base={{
          id: base.id,
          name: base.name,
          nameTranslate: base.nameTranslate ?? "",
          price: base.price,
          description: base.description ?? "",
          descriptionTranslate: base.descriptionTranslate ?? "",
          paramsCount: parseParams(base.params).filter((x) => x.value.trim()).length,
        }}
      />
    </>
  );
}
