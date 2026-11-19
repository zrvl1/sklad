import { db } from "@/lib/db";
import { listTemplates, productFormContext } from "@/lib/templates";
import { getSetting } from "@/lib/util";
import ParamsEditor from "@/components/ParamsEditor";
import { applyToExisting, deleteTemplate, saveTemplate } from "./actions";

// Шаблони опису й характеристик за категоріями
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const [templates, ctx, hasDetails] = await Promise.all([listTemplates(), productFormContext(), getSetting("ymlHasDetails")]);
  const counts = await db.product.groupBy({ by: ["categoryName"], where: { deletedAt: null }, _count: { _all: true } });
  const countOf = (c: string | null) => (c ? counts.find((x) => x.categoryName === c)?._count._all ?? 0 : counts.reduce((s, x) => s + x._count._all, 0));

  const form = (t?: (typeof templates)[number]) => (
    <form action={saveTemplate} className="panel" key={t?.id ?? "new"}>
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="grid2">
        <label>
          Назва шаблону
          <input name="name" defaultValue={t?.name ?? ""} required placeholder="напр. Ланцюги" />
        </label>
        <label>
          Категорія (порожньо — для всіх товарів)
          <input name="categoryName" list="tpl-categories" defaultValue={t?.categoryName ?? ""} autoComplete="off" />
        </label>
        <label>
          Виробник за замовчуванням
          <input name="manufacturer" defaultValue={t?.manufacturer ?? ""} />
        </label>
        <label>
          Постачальник за замовчуванням
          <input name="supplierName" list="tpl-suppliers" defaultValue={t?.supplierName ?? ""} autoComplete="off" />
        </label>
        <label>
          Країна виробник за замовчуванням
          <input name="country" defaultValue={t?.country ?? ""} placeholder="Китай" />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Опис RU (можна HTML). Підстановки: {"{name}"} {"{sku}"} {"{manufacturer}"} {"{category}"} {"{supplier}"} {"{barcode}"}
          <textarea name="description" rows={5} defaultValue={t?.description ?? ""} />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Опис UA (у {"{name}"} підставиться українська назва товару)
          <textarea name="descriptionTranslate" rows={5} defaultValue={t?.descriptionTranslate ?? ""} />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Пошукові запити RU, через кому (напр. «{"{name}"}, тормозные колодки на мотоцикл, колодки {"{manufacturer}"}»)
          <input name="keywords" defaultValue={t?.keywords ?? ""} />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Пошукові запити UA (порожньо — перекладуться з RU автоматично)
          <input name="keywordsUa" defaultValue={t?.keywordsUa ?? ""} />
        </label>
        <div style={{ gridColumn: "1 / -1" }}>
          <div className="muted small" style={{ marginBottom: 6 }}>
            Характеристики (значення можна залишити порожнім — заповните в товарі; порожні в SalesDrive не відправляються)
          </div>
          <ParamsEditor name="params" initial={t?.params ?? []} />
        </div>
      </div>
      <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
        <button className="btn primary">{t ? "Зберегти" : "Створити шаблон"}</button>
        {t && <span className="muted small">Товарів у категорії: {countOf(t.categoryName)}</span>}
        <span className="spacer" />
        {t && (
          <>
            <button className="btn" formAction={applyToExisting} disabled={hasDetails !== "1"} title="Заповнити товари категорії з порожнім описом/характеристиками">
              Застосувати до наявних товарів
            </button>
            <button className="btn danger" formAction={deleteTemplate}>
              Видалити
            </button>
          </>
        )}
      </div>
    </form>
  );

  return (
    <>
      <h1>Шаблони опису й характеристик</h1>
      {msg && <div className={`msg ${msg.startsWith("Помилка") ? "err" : "ok"}`}>{msg}</div>}
      <p className="muted small">
        Шаблон підставляється в новий товар за категорією: опис, характеристики, виробник, постачальник. Те, що ви вписали вручну, не замінюється. Якщо
        для категорії немає свого шаблону, береться загальний (без категорії).
      </p>
      {hasDetails !== "1" && (
        <div className="msg warn small">
          Щоб бачити й редагувати наявні описи та характеристики, увімкніть у YML-експорті SalesDrive «Експортувати опис, фото та характеристики» і
          синхронізуйтесь.
        </div>
      )}
      <datalist id="tpl-categories">
        {ctx.categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="tpl-suppliers">
        {ctx.suppliers.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
      {templates.map((t) => form(t))}
      <h2>Новий шаблон</h2>
      {form()}
    </>
  );
}
