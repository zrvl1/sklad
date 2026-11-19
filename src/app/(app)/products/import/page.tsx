import Link from "next/link";
import { dateTimeUa } from "@/lib/util";
import { loadImport, planKits } from "@/lib/sdimport";
import { applySdKits, uploadSdExport } from "./actions";

// Звірка комплектів з Excel-експортом SalesDrive
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  const imp = await loadImport();
  const plan = imp ? await planKits(imp.rows) : null;
  const kitsInFile = imp ? imp.rows.filter((r) => r.kitRef).length : 0;

  return (
    <>
      <h1>Комплекти з Excel SalesDrive</h1>
      {err && <div className="msg err">{err}</div>}
      <p className="muted small">
        SalesDrive → Товари → Експорт у Excel (усі товари). У колонці «Комплект» видно, з якого товару складається кожна картка — додаток прив&apos;яже
        картки до основних товарів точно так, як у SalesDrive. Спершу перегляд, потім «Застосувати».
      </p>
      <form action={uploadSdExport} className="panel row">
        <input type="file" name="file" accept=".xlsx" required />
        <button className="btn primary">Завантажити й переглянути</button>
      </form>

      {imp && plan && (
        <>
          <div className="stats">
            <div className="stat">
              Файл від {dateTimeUa(new Date(imp.at))}
              <b>{imp.rows.length} товарів</b>
            </div>
            <div className="stat">
              Карток-комплектів у файлі
              <b>{kitsInFile}</b>
            </div>
            <div className="stat">
              Уже правильно
              <b>{plan.same}</b>
            </div>
            <div className="stat">
              Прив&apos;язати / виправити
              <b>{plan.link.length}</b>
            </div>
            <div className="stat">
              Відв&apos;язати
              <b>{plan.unlink.length}</b>
            </div>
          </div>

          {plan.problems.length > 0 && (
            <div className="msg warn small">
              {plan.problems.slice(0, 20).map((p, i) => (
                <div key={i}>{p}</div>
              ))}
            </div>
          )}

          {plan.link.length + plan.unlink.length > 0 ? (
            <form action={applySdKits}>
              <button className="btn primary">Застосувати ({plan.link.length + plan.unlink.length} змін)</button>
            </form>
          ) : (
            <div className="msg ok">Усі комплекти в додатку збігаються з SalesDrive.</div>
          )}

          {plan.link.length > 0 && (
            <div className="tablewrap" style={{ marginTop: 12 }}>
              <table className="small">
                <thead>
                  <tr>
                    <th>Картка</th>
                    <th>→ Основний товар (як у SalesDrive)</th>
                    <th>Зараз у додатку</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.link.map((l) => (
                    <tr key={l.kitId}>
                      <td>
                        <Link href={`/products/${l.kitId}`}>{l.kitSku}</Link> {l.kitName}
                      </td>
                      <td>
                        <b>{l.baseSku}</b> {l.qty !== 1 ? `×${l.qty}` : ""} {l.baseName}
                      </td>
                      <td className="muted">{l.was}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {plan.unlink.length > 0 && (
            <>
              <h2>Відв&apos;язати (у SalesDrive це окремі товари)</h2>
              <div className="tablewrap">
                <table className="small">
                  <tbody>
                    {plan.unlink.map((l) => (
                      <tr key={l.kitId}>
                        <td>
                          <Link href={`/products/${l.kitId}`}>{l.kitSku}</Link> {l.kitName}
                        </td>
                        <td className="muted">{l.was}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
