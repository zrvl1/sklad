/** Зменшити фото в браузері до 1600 px по довшій стороні, JPEG 85% — швидше вантажиться і менше місця */
export async function shrink(file: File): Promise<File> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), "image/jpeg", 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}
