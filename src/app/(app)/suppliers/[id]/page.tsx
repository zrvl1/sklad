import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, requirePerm } from "@/lib/auth";
import { dateInput, dateTimeUa, dateUa, getSetting, money } from "@/lib/util";
import { getRates } from "@/lib/currency";
import { DEFAULT_EXTRA_PARAMS, priceFromRrp } from "@/lib/supplierFeed";
import { supplierBalance } from "@/lib/supplierLedger";
import { allCategories } from "@/lib/categories";
import { MONEY_ACCOUNTS } from "@/lib/finance-consts";
import CreateFromFeed from "@/components/CreateFromFeed";
import { addPayment, deletePayment, loadFeed, saveSupplierFeed } from "../actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SP = Promise<{ msg?: string; err?: string; q?: string; only?: string }>;

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const user = await requirePerm("receipts");
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number(idStr);
  const s = await db.supplier.findUnique({ where: { id } });
  if (!s) notFound();
  const showMoney = can(user, "costs");
  const canCreate = can(user, "products.edit");

  const q = sp.q?.trim() ?? "";
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const where = {
    supplierId: id,
    ...(words.length
      ? { AND: words.map((w) => ({ OR: [{ code: { contains: w, mode: "insensitive" as const } }, { article: { contains: w, mode: "insensitive" as const } }, { name: { contains: w, mode: "insensitive" as const } }] })) }
      : {}),
  };
  const [items, totalItems, rates, cats, mapRaw, bal, payments, linkedCount] = await Promise.all([
    q || sp.only === "new" ? db.supplierItem.findMany({ where, orderBy: { name: "asc" }, take: 100 }) : Promise.resolve([]),
    db.supplierItem.count({ where: { supplierId: id } }),
    getRates(),
    allCategories(),
    getSetting("feedCategoryMap"),
    showMoney ? supplierBalance(id, s.currency, s.ledgerFrom ?? new Date()) : Promise.resolve(null),
    showMoney ? db.supplierPayment.findMany({ where: { supplierId: id }, orderBy: { date: "desc" }, take: 30 }) : Promise.resolve([]),
    db.product.count({ where: { supplierId: id, deletedAt: null } }),
  ]);
  const owners = new Map<string, { id: number; name: string; price: number }>(
    (await db.productCode.findMany({ where: { code: { in: items.map((i) => i.code) }, product: { deletedAt: null } }, // видалені товари не рахуються — можна створити заново include: { product: { select: { id: true, name: true, price: true } } } })).map((c) => [
      c.code,
      c.product,
    ])
  );
  let catMap: Record<string, string> = {};
  try {
    catMap = JSON.parse(mapRaw ?? "{}");
  } catch {}
  const defCat = (feedCat: string | null) => {
    if (!feedCat) return "";
    const mapped = catMap[`${id}:${feedCat}`];
    if (mapped) return mapped;
    const same = cats.filter((c) => c.name.toLowerCase() === feedCat.toLowerCase());
    return same.length === 1 ? same[0].path : "";
  };
  const rate = rates[s.currency];

  return (
    <>
      <p>
        <Link href="/suppliers">← Постачальники</Link>
      </p>
      <h1>{s.name}</h1>
      {sp.msg && <div className="msg">{sp.msg}</div>}
      {sp.err && <div className="msg err">{sp.err}</div>}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Товари з XML постачальника</h2>
        {s.feedUrl ? (
          <p className="small">
            У фіді: <b>{totalItems}</b> товарів · ваших карток від цього постачальника: <b>{linkedCount}</b> · оновлено {dateTimeUa(s.feedAt) || "ще ні"}
            {s.feedError && <span className="badge err" style={{ marginLeft: 6 }}>помилка: {s.feedError}</span>}
          </p>
        ) : (
          <p className="small muted">Вставте нижче постійне посилання на XML постачальника й натисніть «Завантажити».</p>
        )}
        <form action={loadFeed} style={{ marginBottom: 10 }}>
          <input type="hidden" name="id" value={id} />
          <button className="btn sm" disabled={!s.feedUrl}>
            ⟳ Завантажити фід зараз
          </button>{" "}
          <span className="small muted">Також оновлюється автоматично щодня о 07:00: ціни (РРЦ), наявність. Назви й описи ваших карток не чіпаються.</span>
        </form>
        <form className="row" style={{ marginBottom: 10 }}>
          <input name="q" defaultValue={q} placeholder="Код з накладної, артикул або назва" style={{ minWidth: 320 }} autoFocus />
          <button className="btn sm">Знайти</button>
          <Link href={`/suppliers/${id}?only=new`} className="small">
            показати перші 100
          </Link>
          {canCreate && totalItems > 0 && (
            <Link href={`/suppliers/${id}/categories`} className="small">
              категорії фіду → сайту
            </Link>
          )}
        </form>
        {items.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Код</th>
                <th>Артикул</th>
                <th>Назва</th>
                <th>Ціна у фіді</th>
                <th>Буде ціна</th>
                <th>Фото / характ.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const pics = JSON.parse(it.pictures ?? "[]") as string[];
                const prm = JSON.parse(it.params ?? "[]") as unknown[];
                const own = owners.get(it.code);
                const willBe = s.feedPriceType === "rrp" ? priceFromRrp(it.price, it.currency, rates, s.roundTo) : null;
                return (
                  <tr key={it.id} style={it.available ? undefined : { opacity: 0.6 }}>
                    <td>
                      <b>{it.code}</b>
                    </td>
                    <td className="small">{it.article}</td>
                    <td>
                      {it.name}
                      <div className="small muted">
                        {it.brand} {it.category ? `· ${it.category}` : ""} {!it.available && "· немає в наявності"}
                      </div>
                    </td>
                    <td>
                      {it.price} {it.currency}
                      <div className="small muted">{s.feedPriceType === "rrp" ? "РРЦ" : "закупівля"}</div>
                    </td>
                    <td>{willBe ? `${willBe} грн` : "—"}</td>
                    <td className="small">
                      {pics.length} / {prm.length}
                    </td>
                    <td>
                      {own ? (
                        <Link href={`/products/${own.id}`} className="small">
                          ✓ є: {own.name}
                        </Link>
                      ) : canCreate ? (
                        <CreateFromFeed supplierId={id} code={it.code} categoryOptions={cats} defaultCategory={defCat(it.category)} />
                      ) : (
                        <span className="small muted">немає картки</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {q && !items.length && <p className="muted">Нічого не знайдено за «{q}».</p>}
      </div>

      {showMoney && bal && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Розрахунки ({s.currency})</h2>
          <p className="small muted">
            {s.ledgerFrom
              ? `Облік з ${dateUa(s.ledgerFrom)}: враховуються приходи з цієї дати (раніші вважаються оплаченими). Дату можна змінити в налаштуваннях нижче.`
              : "Облік ще не ведеться: почнеться з першої записаної оплати, або вкажіть дату старту в налаштуваннях нижче (наприклад, дату першої неоплаченої накладної)."}
          </p>
          <div className="row" style={{ gap: 24, marginBottom: 10 }}>
            <div>
              Приходів: <b>{money(bal.receipts)} {s.currency}</b>
              {s.currency !== "UAH" && <div className="small muted">у собівартості {money(bal.receiptsUah)} грн</div>}
            </div>
            <div>
              Оплачено: <b>{money(bal.paid)} {s.currency}</b>
              {s.currency !== "UAH" && <div className="small muted">витрачено {money(bal.paidUah)} грн</div>}
            </div>
            <div>
              {bal.debt >= 0 ? "Борг" : "Аванс"}: <b style={{ fontSize: 18 }}>{money(Math.abs(bal.debt))} {s.currency}</b>
              {s.currency !== "UAH" && bal.avgRate && (
                <div className="small muted">
                  середній курс боргу {bal.avgRate} · зараз {rate} → оплата сьогодні ≈ {money(bal.debt * (rate ?? 0))} грн
                </div>
              )}
            </div>
            {s.currency !== "UAH" && (
              <div>
                Курсова різниця:{" "}
                <b style={{ color: bal.fxDiff > 0 ? "#b91c1c" : bal.fxDiff < 0 ? "#15803d" : undefined }}>
                  {bal.fxDiff > 0 ? "−" : bal.fxDiff < 0 ? "+" : ""}
                  {money(Math.abs(bal.fxDiff))} грн
                </b>
              </div>
            )}
          </div>
          <form action={addPayment} className="row" style={{ marginBottom: 10 }}>
            <input type="hidden" name="supplierId" value={id} />
            <input type="hidden" name="currency" value={s.currency} />
            <input type="date" name="date" defaultValue={dateInput(new Date())} />
            <input name="amount" placeholder={`Сплачено, ${s.currency}`} inputMode="decimal" style={{ width: 130 }} required />
            {s.currency !== "UAH" && <input name="uah" placeholder="Це коштувало, грн" inputMode="decimal" style={{ width: 150 }} required />}
            <select name="account" defaultValue="Готівка">
              {MONEY_ACCOUNTS.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <input name="note" placeholder="Примітка" />
            <button className="btn sm">Записати оплату</button>
          </form>
          {s.currency !== "UAH" && (
            <p className="small muted">
              «Це коштувало, грн» — скільки гривень реально пішло: купили долари в обміннику / з картки — сума купівлі; віддали гривнями готівкою —
              віддана сума. Різницю з собівартістю додаток запише в «Гроші за місяць» як «Курсова різниця».
            </p>
          )}
          {payments.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Сума</th>
                  <th>Грн</th>
                  <th>Курс</th>
                  <th>Різниця</th>
                  <th>Примітка</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{dateUa(p.date)}</td>
                    <td>
                      {money(p.amount)} {p.currency}
                    </td>
                    <td>{money(p.uah)}</td>
                    <td className="small">
                      {(p.uah / p.amount).toFixed(2)}
                      {p.currency !== "UAH" && <span className="muted"> (собів. {(p.bookedUah / p.amount).toFixed(2)})</span>}
                    </td>
                    <td style={{ color: p.diffUah > 0 ? "#b91c1c" : p.diffUah < 0 ? "#15803d" : undefined }}>
                      {Math.abs(p.diffUah) >= 1 ? `${p.diffUah > 0 ? "−" : "+"}${money(Math.abs(p.diffUah))}` : "—"}
                    </td>
                    <td className="small">{p.note}</td>
                    <td>
                      <form action={deletePayment}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="btn sm secondary">×</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Налаштування постачальника</h2>
        <form action={saveSupplierFeed} className="stack" style={{ maxWidth: 640 }}>
          <input type="hidden" name="id" value={id} />
          <label>
            Назва <input name="name" defaultValue={s.name} />
          </label>
          <label>
            Телефон <input name="phone" defaultValue={s.phone ?? ""} />
          </label>
          <label>
            Посилання на XML (постійне)
            <input name="feedUrl" defaultValue={s.feedUrl ?? ""} placeholder="https://…/price.xml" style={{ width: "100%" }} />
          </label>
          <label>
            Ціна &lt;price&gt; у фіді — це
            <select name="feedPriceType" defaultValue={s.feedPriceType}>
              <option value="rrp">РРЦ — ціна продажу (ціна на сайті = РРЦ × курс)</option>
              <option value="cost">Моя закупівля (ціну продажу ставлю сам)</option>
            </select>
          </label>
          <label>
            Валюта розрахунків
            <select name="currency" defaultValue={s.currency}>
              <option>USD</option>
              <option>EUR</option>
              <option>UAH</option>
            </select>
          </label>
          <label>
            Округлення ціни продажу вгору до, грн
            <select name="roundTo" defaultValue={String(s.roundTo)}>
              {[1, 5, 10, 50, 100].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Характеристики, які додаються до кожного товару (рядок «Назва: значення»)
            <textarea name="extraParams" rows={3} defaultValue={s.extraParams ?? DEFAULT_EXTRA_PARAMS} />
          </label>
          <label>
            Вести борг з дати (приходи до неї вважаються оплаченими)
            <input type="date" name="ledgerFrom" defaultValue={dateInput(s.ledgerFrom)} />
          </label>
          <label>
            Примітка <input name="note" defaultValue={s.note ?? ""} />
          </label>
          <div>
            <button className="btn">Зберегти</button>
          </div>
        </form>
      </div>
    </>
  );
}
