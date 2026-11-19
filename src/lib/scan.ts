/**
 * Сканер (і 2.4G, і USB) «друкує» код як клавіатура. Якщо в Windows увімкнена українська розкладка,
 * літери приходять кирилицею: CM0361 → СЬ0361. Перекладаємо назад на латиницю за розташуванням клавіш.
 */
const UA = "йцукенгшщзхїфівапролджєячсмитьбюґЙЦУКЕНГШЩЗХЇФІВАПРОЛДЖЄЯЧСМИТЬБЮҐыэъЫЭЪ";
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`QWERTYUIOP[]ASDFGHJKL;'ZXCVBNM,.`s'[S'[";

export function fixLayout(code: string) {
  if (!/[а-яіїєґё]/i.test(code)) return code;
  let out = "";
  for (const ch of code) {
    const i = UA.indexOf(ch);
    out += i >= 0 ? EN[i] : ch;
  }
  return out;
}

/** Варіанти коду для пошуку: як є, з виправленою розкладкою, великими літерами */
export function scanVariants(raw: string) {
  const c = raw.trim();
  const fixed = fixLayout(c);
  return [...new Set([c, fixed, c.toUpperCase(), fixed.toUpperCase()])].filter(Boolean);
}
