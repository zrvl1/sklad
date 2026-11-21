"use server";

import { requireUser } from "@/lib/auth";
import { setSetting } from "@/lib/util";

/** Зсув друку етикеток (мм) — зберігається на сервері, однаковий для всіх браузерів і ярликів */
export async function saveLabelOffset(tpl: string, x: number, y: number) {
  await requireUser();
  const clamp = (v: number) => Math.max(-20, Math.min(20, Number.isFinite(v) ? v : 0));
  await setSetting(`labelOffset:${tpl.replace(/[^\w-]/g, "")}`, JSON.stringify({ x: clamp(x), y: clamp(y) }));
}
