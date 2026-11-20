/**
 * Перевірка мови тексту: російські літери (ы э ъ ё) в українському тексті й українські (і ї є ґ) в російському.
 * Повертає слова-порушники (до 8), щоб було видно, що виправити.
 */
const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ");

export function foreignWords(text: string | null | undefined, lang: "ru" | "ua") {
  if (!text) return [];
  const re = lang === "ua" ? /[ыэъё]/i : /[іїєґ]/i;
  const words = strip(text).match(/[A-Za-zА-Яа-яЁёІіЇїЄєҐґ'’-]+/g) ?? [];
  return [...new Set(words.filter((w) => /[а-яёіїєґ]/i.test(w) && re.test(w)))].slice(0, 8);
}

export type LangIssue = { field: string; words: string[] };

export function langIssues(p: { name: string; nameTranslate?: string | null; description?: string | null; descriptionTranslate?: string | null }) {
  const out: LangIssue[] = [];
  const add = (field: string, words: string[]) => words.length && out.push({ field, words });
  add("Назва RU (є українські слова)", foreignWords(p.name, "ru"));
  add("Назва UA (є російські слова)", foreignWords(p.nameTranslate, "ua"));
  add("Опис RU (є українські слова)", foreignWords(p.description, "ru"));
  add("Опис UA (є російські слова)", foreignWords(p.descriptionTranslate, "ua"));
  return out;
}
