/** Назва для показу в додатку — українська (якщо є), інакше російська */
export const ua = (p: { name: string; nameTranslate?: string | null }) => p.nameTranslate?.trim() || p.name;
