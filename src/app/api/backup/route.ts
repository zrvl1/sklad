import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { logAction } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Резервна копія всіх даних додатку одним JSON-файлом (лише адміністратор).
 * Паролі користувачів і журнал спроб входу не вивантажуються.
 * Товари, заявки й залишки є також у SalesDrive; тут найцінніше — комірки, приходи, рух товару, гроші, шаблони.
 */
export async function GET() {
  const user = await getUser();
  if (!user || user.role !== "admin") return new Response("forbidden", { status: 403 });

  const data = {
    users: await db.user.findMany({ select: { id: true, name: true, login: true, role: true, active: true, createdAt: true } }),
    warehouses: await db.warehouse.findMany(),
    cells: await db.cell.findMany(),
    suppliers: await db.supplier.findMany(),
    products: await db.product.findMany(),
    productCodes: await db.productCode.findMany(),
    productCells: await db.productCell.findMany(),
    stockBalances: await db.stockBalance.findMany(),
    stockMoves: await db.stockMove.findMany(),
    receipts: await db.receipt.findMany(),
    receiptLines: await db.receiptLine.findMany(),
    writeOffs: await db.writeOff.findMany(),
    writeOffLines: await db.writeOffLine.findMany(),
    inventories: await db.inventory.findMany(),
    inventoryLines: await db.inventoryLine.findMany(),
    money: await db.expense.findMany(),
    templates: await db.productTemplate.findMany(),
    deletedProducts: await db.deletedProduct.findMany(),
    deletedProductSites: await db.deletedProductSite.findMany(),
    orders: await db.sdOrder.findMany(),
    orderLines: await db.sdOrderLine.findMany(),
    orderTtns: await db.orderTtn.findMany(),
    orderPacks: await db.orderPack.findMany(),
    currencies: await db.currency.findMany(),
    settings: await db.setting.findMany({ where: { key: { not: "lastSdResponse" } } }),
    actionLog: await db.actionLog.findMany({ orderBy: { id: "desc" }, take: 20000 }),
  };
  await logAction(user.id, "backup-download", "settings", null);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new Response(JSON.stringify({ app: "sklad", version: 1, createdAt: new Date().toISOString(), data }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="sklad-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
