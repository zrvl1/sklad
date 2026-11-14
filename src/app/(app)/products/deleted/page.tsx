import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getSites } from "@/lib/deleted";
import { dateTimeUa, money } from "@/lib/util";
import { markSiteDone, saveSites, setSiteStatus } from "./actions";
import { restoreProduct } from "../actions";

type SP = Promise<{ site?: string; show?: string; q?: string; msg?: string }>;

const STATUS: Record<string, { label: string; cls: string }> = {
  todo: { label: "треба видалити", cls: "warn" },
  done: { label: "видалено", cls: "ok" },
  skip: { label: "не було / не треба", cls: "" },
};

// Журнал видалених товарів і завдання «прибрати на сайтах»
export default async function DeletedPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await requireUser();
  const sites = await getSites();
  const show = sp.show ?? "todo"; // todo — лише ті, де є невиконані завдання; all — усі

  const where: Prisma.DeletedProductWhereInput = {};
  if (show === "todo") where.sites = { some: { status: "todo", ...(sp.site ? { site: sp.site } : {}) } };
  if (sp.q) where.OR = [{ name: { contains: sp.q, mode: "insensitive" } }, { sku: { contains: sp.q } }, { sdId: { contains: sp.q } }, { barcode: { contains: sp.q } }];

  const [rows, counts] = await Promise.all([
    db.deletedProduct.findMany({ where, include: { sites: true }, orderBy: { deletedAt: "desc" }, take: 300 }),
    db.deletedProductSite.groupBy({ by: ["site"], where: { status: "todo" }, _count: { _all: true } }),
  ]);
  const todo = new Map<string, number>(counts.map((c) => [c.site, c._count._all]));
  const qs = (patch: Record<string, string>) => `?${new URLSearchParams({ ...(sp.site ? { site: sp.site } : {}), show, ...(sp.q ? { q: sp.q } : {}), ...patch })}`;

  return (
    <>
      <h1>Видалені товари</h1>
      {sp.msg && <div className={`msg ${sp.msg.startsWith("Помилка") ? "err" : "ok"}`}>{sp.msg}</div>}
      <p className="muted small">
        Сюди потрапляють товари, видалені в додатку або прямо в SalesDrive. Prom і Horoshop їх самі не видаляють — прибирайте вручну й позначайте тут
        статус. Вивантаження списку дає ID, артикули й штрихкоди для пошуку на сайті.
      </p>

      <div className="stats">
        {sites.map((s) => (
          <div className="stat" key={s}>
            {s}: треба видалити
            <b>{todo.get(s) ?? 0}</b>
            <span className="row" style={{ gap: 6, marginTop: 6 }}>
              <Link className="btn sm" href={qs({ site: s, show: "todo" })}>
                показати
              </Link>
              <a className="btn sm" href={`/api/deleted/export?site=${encodeURIComponent(s)}`}>
                ⬇ CSV
              </a>
              {(todo.get(s) ?? 0) > 0 && (
                <form action={markSiteDone}>
                  <input type="hidden" name="site" value={s} />
                  <button className="btn sm" title="Позначити всі як видалені на цьому сайті">
                    ✓ усі
                  </button>
                </form>
              )}
            </span>
          </div>
        ))}
      </div>

      <form className="toolbar">
        <input name="q" defaultValue={sp.q} placeholder="Назва, артикул, ID, штрихкод" style={{ width: 260 }} />
        <select name="show" defaultValue={show}>
          <option value="todo">лише з невиконаними</option>
          <option value="all">усі видалені</option>
        </select>
        <select name="site" defaultValue={sp.site ?? ""}>
          <option value="">усі сайти</option>
          {sites.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="btn">Показати</button>
      </form>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Видалено</th>
              <th>Товар</th>
              <th>Звідки</th>
              {sites.map((s) => (
                <th key={s}>{s}</th>
              ))}
              {user.role === "admin" && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="small">{dateTimeUa(d.deletedAt)}</td>
                <td>
                  {d.productId ? <Link href={`/products/${d.productId}`}>{d.name}</Link> : d.name}
                  <div className="muted small">
                    ID {d.sdId ?? "—"} · арт. {d.sku ?? "—"} · ш/к {d.barcode ?? "—"} · {money(d.price)} грн
                    {d.categoryName && ` · ${d.categoryName}`}
                  </div>
                  {d.reason && <div className="small">{d.reason}</div>}
                </td>
                <td className="small">{d.source === "crm" ? "у SalesDrive" : "у додатку"}</td>
                {sites.map((s) => {
                  const st = d.sites.find((x) => x.site === s);
                  if (!st) return <td key={s} className="muted">—</td>;
                  return (
                    <td key={s}>
                      <span className={`badge ${STATUS[st.status]?.cls ?? ""}`} title={st.doneBy ? `${st.doneBy}, ${dateTimeUa(st.doneAt)}` : ""}>
                        {STATUS[st.status]?.label ?? st.status}
                      </span>
                      <form action={setSiteStatus} className="row" style={{ gap: 4, marginTop: 4 }}>
                        <input type="hidden" name="id" value={st.id} />
                        {st.status !== "done" && (
                          <button className="btn sm" name="status" value="done" title="Видалено на сайті">
                            ✓
                          </button>
                        )}
                        {st.status === "todo" && (
                          <button className="btn sm" name="status" value="skip" title="Товару не було на цьому сайті">
                            не було
                          </button>
                        )}
                        {st.status !== "todo" && (
                          <button className="btn sm" name="status" value="todo" title="Повернути в «треба видалити»">
                            ↺
                          </button>
                        )}
                      </form>
                    </td>
                  );
                })}
                {user.role === "admin" && (
                  <td>
                    {d.productId && !d.reason?.includes("відновлено") && (
                      <form action={restoreProduct}>
                        <input type="hidden" name="deletedId" value={d.id} />
                        <button className="btn sm" title="Відновити товар і знову створити його в SalesDrive">
                          Відновити
                        </button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4 + sites.length} className="muted">
                  {show === "todo" ? "Усе прибрано на сайтах 👍" : "Видалених товарів немає"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {user.role === "admin" && (
        <form action={saveSites} className="panel row" style={{ marginTop: 16 }}>
          <label style={{ flex: 1 }}>
            Сайти й маркетплейси, де прибирати видалені товари (через кому)
            <input name="sites" defaultValue={sites.join(", ")} />
          </label>
          <button className="btn">Зберегти</button>
        </form>
      )}
    </>
  );
}
