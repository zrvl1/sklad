import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { logAction } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Файл для імпорту на Prom: українські пошукові запити.
 * Prom API не має окремого поля для українських запитів, а YML із SalesDrive віддає лише російські —
 * тому заливаємо їх файлом (Prom → Імпорт → з компʼютера, «Тільки оновлення», лише «Пошукові запити (українською)»).
 * Українські запити беремо з картки товару; якщо порожньо — перекладаємо російські (DeepL або словник) і зберігаємо в картку.
 */
export async function GET(req: Request) {
  const only = (new URL(req.url).searchParams.get("sku") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  const user = await getUser();
  if (!user || user.role !== "admin") return new Response("forbidden", { status: 403 });

  const { promConfigured, refreshPromMap } = await import("@/lib/prom");
  if (promConfigured()) {
    try {
      await refreshPromMap();
    } catch {
      /* візьмемо збережену таблицю */
    }
  }
  const links = await db.promLink.findMany({ select: { promId: true, externalId: true } });
  const promBySd = new Map<string, string>();
  for (const l of links) if (l.externalId) promBySd.set(l.externalId, l.promId);

  const products = await db.product.findMany({
    where: { deletedAt: null, sdId: { not: null }, keywords: { not: null } },
    select: { id: true, sku: true, sdId: true, name: true, nameTranslate: true, keywords: true, keywordsUa: true },
    orderBy: { sku: "asc" },
  });
  const rows = products.filter(
    (p) => p.keywords?.trim() && promBySd.has(p.sdId as string) && (!only.length || only.includes((p.sku ?? "").toUpperCase())),
  );

  // переклад відсутніх
  const need = rows.filter((p) => !p.keywordsUa?.trim());
  if (need.length) {
    const { translate, translateConfigured } = await import("@/lib/translate");
    const { translateKeywords } = await import("@/lib/ruua");
    for (let i = 0; i < need.length; i += 50) {
      const chunk = need.slice(i, i + 50);
      let tr: string[] = chunk.map((p) => translateKeywords(p.keywords as string));
      if (translateConfigured()) {
        try {
          tr = await translate(chunk.map((p) => p.keywords as string), "RU", "UK");
        } catch {
          /* словник */
        }
      }
      for (const [k, p] of chunk.entries()) {
        const v = tr[k]?.trim();
        if (!v) continue;
        p.keywordsUa = v;
        await db.product.update({ where: { id: p.id }, data: { keywordsUa: v } });
      }
    }
  }

  const esc = (v: string | null | undefined) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const head = ["Код_товару", "Назва_позиції", "Назва_позиції_укр", "Пошукові_запити_укр", "Унікальний_ідентифікатор", "Ідентифікатор_товару"];
  const lines = [head.join(",")];
  for (const p of rows) {
    lines.push([esc(p.sku), esc(p.name), esc(p.nameTranslate || p.name), esc(p.keywordsUa), esc(promBySd.get(p.sdId as string)), esc(p.sdId)].join(","));
  }
  await logAction(user.id, "prom-kw-file", "settings", null, `рядків ${rows.length}, перекладено ${need.length}`);
  const date = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prom-ua-keywords-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
