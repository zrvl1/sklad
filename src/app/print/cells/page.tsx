import { Suspense } from "react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import Barcode from "@/components/Barcode";
import PrintToolbar from "@/components/PrintToolbar";

// Етикетки для полиць/комірок: великий код + штрихкод (сканується при приході та інвентаризації)
export default async function PrintCells({ searchParams }: { searchParams: Promise<{ warehouse?: string; ids?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const ids = (sp.ids ?? "").split(",").map(Number).filter(Boolean);
  const cells = await db.cell.findMany({
    where: ids.length ? { id: { in: ids } } : { warehouseId: Number(sp.warehouse) || undefined },
    include: { warehouse: true },
    orderBy: { code: "asc" },
  });

  return (
    <div style={{ background: "#fff", minHeight: "100vh" }}>
      <style>{`
        body { background: #fff; }
        @page { size: 58mm 40mm; margin: 0; }
        .labels { display: flex; flex-wrap: wrap; gap: 4mm; padding: 4mm; }
        .cell { width: 58mm; height: 40mm; padding: 2mm; border: 0.2mm solid #ccc; display: flex; flex-direction: column;
                justify-content: space-between; align-items: center; font-family: Arial, sans-serif; color: #000; overflow: hidden; }
        .cell .code { font-size: 22pt; font-weight: 800; letter-spacing: .5pt; }
        .cell .wh { font-size: 7pt; }
        @media print { .labels { display: block; padding: 0; } .cell { border: 0; page-break-after: always; break-after: page; } }
      `}</style>
      <Suspense>
        <PrintToolbar count={cells.length} showTemplates={false} />
      </Suspense>
      <div className="labels">
        {cells.map((c) => (
          <div className="cell" key={c.id}>
            <div className="wh">{c.warehouse.name}</div>
            <div className="code">{c.code}</div>
            <Barcode value={`CELL:${c.code}`} height={26} fontSize={0} width={1.3} />
          </div>
        ))}
      </div>
    </div>
  );
}
