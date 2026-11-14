import type { Prisma } from "@prisma/client";

export type ReceiptFilter = { from?: string; to?: string; supplier?: string; warehouse?: string; status?: string; q?: string };

/** Фільтр документів приходу — спільний для журналу, експорту і звітів */
export function receiptFilter(sp: ReceiptFilter): Prisma.ReceiptWhereInput {
  const where: Prisma.ReceiptWhereInput = {};
  if (sp.from || sp.to) {
    const date: Prisma.DateTimeFilter = {};
    if (sp.from) date.gte = new Date(sp.from);
    if (sp.to) date.lte = new Date(`${sp.to}T23:59:59`);
    where.date = date;
  }
  if (sp.supplier) where.supplierId = Number(sp.supplier);
  if (sp.warehouse) where.warehouseId = Number(sp.warehouse);
  if (sp.status) where.status = sp.status;
  if (sp.q) where.OR = [{ number: { contains: sp.q } }, { invoiceNo: { contains: sp.q } }];
  return where;
}

