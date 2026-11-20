/** Фото товару: JSON-масив URL у Product.images (перше — головне) */
export function productImages(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && /^https?:\/\//.test(x)) : [];
  } catch {
    return [];
  }
}
export const mainImage = (json: string | null | undefined) => productImages(json)[0] ?? null;

/** Публічна адреса для фото, завантаженого в додаток */
export const ownImageUrl = (id: string) => `${process.env.APP_URL ?? "https://sklad-tau.vercel.app"}/img/${id}`;
