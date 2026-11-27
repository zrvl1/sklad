/** Фото замалі для Google Merchant (потрібно щонайменше 500×500): збільшуємо на білому квадраті 1000×1000 */
export const MIN_SIDE = 500;
const TARGET = 1000;

type Sharp = (input: Buffer) => {
  metadata(): Promise<{ width?: number; height?: number }>;
  rotate(): ReturnType<Sharp>;
  resize(w: number, h: number, o: object): ReturnType<Sharp>;
  flatten(o: object): ReturnType<Sharp>;
  jpeg(o: object): ReturnType<Sharp>;
  toBuffer(): Promise<Buffer>;
};
async function loadSharp(): Promise<Sharp | null> {
  try {
    const m = (await import("sharp" as string)) as { default?: Sharp };
    return (m.default ?? (m as unknown as Sharp)) as Sharp;
  } catch {
    return null;
  }
}

export async function imageSize(buf: Buffer) {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const m = await sharp(buf).metadata();
    return { w: m.width ?? 0, h: m.height ?? 0 };
  } catch {
    return null;
  }
}

/** Якщо менша сторона < 500 px — вписуємо фото в білий квадрат 1000×1000 (без обрізання). Інакше повертаємо як є. */
export async function enlargeIfSmall(buf: Buffer, mime: string): Promise<{ buf: Buffer; mime: string; changed: boolean }> {
  const sharp = await loadSharp();
  if (!sharp) return { buf, mime, changed: false };
  try {
    const m = await sharp(buf).metadata();
    const w = m.width ?? 0, h = m.height ?? 0;
    if (!w || !h || Math.min(w, h) >= MIN_SIDE) return { buf, mime, changed: false };
    const out = await sharp(buf)
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize(TARGET, TARGET, { fit: "contain", background: "#ffffff", kernel: "lanczos3", withoutEnlargement: false })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    return { buf: out, mime: "image/jpeg", changed: true };
  } catch {
    return { buf, mime, changed: false };
  }
}
