/** ID товару для SalesDrive, створеного в додатку: 10 цифр, як у SalesDrive, з 9 на початку (їхні зараз ~2–3 млрд) */
export const appSdId = (productId: number) => `9${String(productId).padStart(9, "0")}`;

/** Товар створено в додатку (старий формат W000123 або новий 9000000123) */
export const isAppSdId = (sdId: string | null | undefined) => Boolean(sdId && (/^W\d+$/.test(sdId) || /^9\d{9}$/.test(sdId)));
