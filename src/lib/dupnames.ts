import { db } from "./db";
import { ua } from "./names";

/** Марки мотоциклів: бренд деталі вставляємо перед першою з них ([Що] [бренд] [мотоцикли]) */
const MOTO =
  /\b(lifan|kovi|geon|musstang|mustang|shineray|tekken|bajaj|atv|sharx|loncin|zongshen|bse|kayo|motoleader|forte|spark|viper|honda|yamaha|suzuki|kawasaki|ktm|otom|soul|hornet|minsk|jawa|cf\s?moto|lf\d|ttg)\b/i;

/** Вставити бренд у назву: перед першою маркою мотоцикла або перед розміром; інакше — у кінець */
export function withBrand(name: string, brand: string) {
  const b = brand.trim();
  if (!b || name.toLowerCase().includes(b.toLowerCase())) return name;
  const m = name.match(MOTO);
  if (m && m.index !== undefined && m.index > 0) return `${name.slice(0, m.index).trimEnd()} ${b} ${name.slice(m.index)}`;
  return `${name} ${b}`;
}

export type DupItem = {
  id: number;
  sku: string | null;
  name: string;
  nameTranslate: string | null;
  manufacturer: string | null;
  price: number;
  cost: number;
  images: string | null;
  stock: number;
  baseProductId: number | null;
  sugUa: string;
  sugRu: string;
  note: string | null;
};

/** Групи товарів з однаковою (українською) назвою і пропозиції унікальних назв */
export async function dupGroups() {
  const all = await db.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      sku: true,
      name: true,
      nameTranslate: true,
      manufacturer: true,
      price: true,
      cost: true,
      images: true,
      baseProductId: true,
      stocks: { select: { qty: true } },
      base: { select: { stocks: { select: { qty: true } } } },
    },
  });
  const by = new Map<string, typeof all>();
  for (const p of all) {
    const k = ua(p).trim().toLowerCase().replace(/\s+/g, " ");
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  const groups: DupItem[][] = [];
  for (const g of by.values()) {
    if (g.length < 2) continue;
    const brands = g.map((p) => p.manufacturer?.trim() || "");
    const distinct = new Set(brands.filter(Boolean).map((b) => b.toLowerCase()));
    groups.push(
      g.map((p, i) => {
        const brand = brands[i];
        const stock = (p.baseProductId ? p.base?.stocks : p.stocks)?.reduce((s, x) => s + x.qty, 0) ?? 0;
        // бренд розрізняє лише тоді, коли в групі бренди різні (або в інших його немає)
        const brandHelps = brand && (distinct.size > 1 || brands.filter((b) => b.toLowerCase() === brand.toLowerCase()).length === 1);
        const uaName = ua(p);
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          nameTranslate: p.nameTranslate,
          manufacturer: p.manufacturer,
          price: p.price,
          cost: p.cost,
          images: p.images,
          stock,
          baseProductId: p.baseProductId,
          sugUa: brandHelps ? withBrand(uaName, brand) : uaName,
          sugRu: brandHelps ? withBrand(p.name, brand) : p.name,
          note: brandHelps
            ? null
            : !brand
              ? "немає бренду — впишіть назву вручну або заповніть бренд"
              : "бренд однаковий — додайте відмінність (оригінал/аналог, к-сть у комплекті) або видаліть зайвий товар",
        };
      })
    );
  }
  return groups.sort((a, b) => b.reduce((s, x) => s + x.stock, 0) - a.reduce((s, x) => s + x.stock, 0));
}
