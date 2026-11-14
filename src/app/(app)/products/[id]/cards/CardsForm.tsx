"use client";

import { useState } from "react";
import { createKitCards } from "../../actions";

type Base = { id: number; name: string; nameTranslate: string; price: number; description: string; descriptionTranslate: string; paramsCount: number };
type Row = { name: string; nameTr: string; price: string; qty: string; desc: string; descTr: string; extra: string };

const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

export default function CardsForm({ base }: { base: Base }) {
  const empty = (): Row => ({ name: "", nameTr: "", price: String(base.price || ""), qty: "1", desc: base.description, descTr: base.descriptionTranslate, extra: "" });
  const [rows, setRows] = useState<Row[]>([empty()]);
  const [models, setModels] = useState("");
  const [tplName, setTplName] = useState("{name} {model}");
  const [tplNameTr, setTplNameTr] = useState(base.nameTranslate ? "{name_tr} {model}" : "");
  const [tplParam, setTplParam] = useState("Сумісність: {model}");
  const [busy, setBusy] = useState(false);

  const set = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  // Із переліку моделей — по картці на модель; {model} підставляється і в описи
  const generate = () => {
    const list = models.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) return;
    const made = list.map((model) => {
      const v = { name: base.name, name_tr: base.nameTranslate || base.name, model };
      return {
        ...empty(),
        name: fill(tplName, v).trim(),
        nameTr: tplNameTr ? fill(tplNameTr, v).trim() : "",
        desc: fill(base.description, v),
        descTr: fill(base.descriptionTranslate, v),
        extra: tplParam ? fill(tplParam, v) : "",
      };
    });
    setRows((rs) => [...rs.filter((r) => r.name.trim()), ...made]);
  };

  return (
    <>
      <details className="panel" open>
        <summary>
          <b>Швидко: картки за переліком моделей</b>
        </summary>
        <div className="grid2" style={{ marginTop: 10 }}>
          <label style={{ gridRow: "span 3" }}>
            Моделі (кожна з нового рядка)
            <textarea rows={7} value={models} onChange={(e) => setModels(e.target.value)} placeholder={"Honda Dio AF-18\nHonda Tact AF-24\nSuzuki Address V50"} />
          </label>
          <label>
            Шаблон назви
            <input value={tplName} onChange={(e) => setTplName(e.target.value)} />
          </label>
          <label>
            Шаблон назви — друга мова
            <input value={tplNameTr} onChange={(e) => setTplNameTr(e.target.value)} placeholder="{name_tr} {model}" />
          </label>
          <label>
            Характеристика для кожної картки
            <input value={tplParam} onChange={(e) => setTplParam(e.target.value)} placeholder="Сумісність: {model}" />
          </label>
        </div>
        <p className="muted small">
          {"{name}"} — назва основного, {"{name_tr}"} — його назва другою мовою, {"{model}"} — модель із переліку (працює і в описах основного).
        </p>
        <button type="button" className="btn" onClick={generate} disabled={!models.trim()}>
          Сформувати картки
        </button>
      </details>

      <form action={createKitCards} onSubmit={() => setBusy(true)}>
        <input type="hidden" name="baseId" value={base.id} />
        <input type="hidden" name="count" value={rows.length} />
        {rows.map((r, i) => (
          <div key={i} className="panel">
            <div className="toolbar" style={{ marginBottom: 8 }}>
              <b>Картка {i + 1}</b>
              <span className="spacer" />
              <button type="button" className="btn sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length === 1}>
                ✕ прибрати
              </button>
            </div>
            <div className="grid2">
              <label style={{ gridColumn: "1 / -1" }}>
                Назва *
                <input name={`name_${i}`} value={r.name} onChange={(e) => set(i, "name", e.target.value)} maxLength={255} placeholder={`${base.name} для …`} />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Назва — друга мова
                <input name={`nameTr_${i}`} value={r.nameTr} onChange={(e) => set(i, "nameTr", e.target.value)} maxLength={255} placeholder="порожньо — така сама" />
              </label>
              <label>
                Ціна, грн
                <input name={`price_${i}`} type="number" min={0} step="0.01" value={r.price} onChange={(e) => set(i, "price", e.target.value)} />
              </label>
              <label>
                Штук основного в картці
                <input name={`qty_${i}`} type="number" min={1} step="any" value={r.qty} onChange={(e) => set(i, "qty", e.target.value)} />
              </label>
            </div>
            <details style={{ marginTop: 8 }}>
              <summary className="small">
                Опис і характеристики {r.extra.trim() ? `· +${r.extra.split(/\r?\n/).filter((x) => x.includes(":")).length} хар.` : ""}
                {base.paramsCount ? ` · ${base.paramsCount} хар. з основного` : ""}
              </summary>
              <div className="grid2" style={{ marginTop: 8 }}>
                <label>
                  Опис
                  <textarea name={`desc_${i}`} rows={5} value={r.desc} onChange={(e) => set(i, "desc", e.target.value)} />
                </label>
                <label>
                  Опис — друга мова
                  <textarea name={`descTr_${i}`} rows={5} value={r.descTr} onChange={(e) => set(i, "descTr", e.target.value)} />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  Додаткові характеристики (кожна з нового рядка «Назва: значення»; така сама назва замінює характеристику основного)
                  <textarea name={`extra_${i}`} rows={3} value={r.extra} onChange={(e) => set(i, "extra", e.target.value)} placeholder={"Сумісність: Honda Dio AF-18\nРік: 1990–1994"} />
                </label>
              </div>
            </details>
          </div>
        ))}
        <div className="toolbar">
          <button type="button" className="btn" onClick={() => setRows((rs) => [...rs, empty()])}>
            ＋ Ще картка
          </button>
          <button className="btn primary" disabled={busy || !rows.some((r) => r.name.trim())}>
            {busy ? "Створюю…" : `Створити ${rows.filter((r) => r.name.trim()).length} карт. і відправити в SalesDrive`}
          </button>
        </div>
      </form>
    </>
  );
}
