"use client";

import { useState } from "react";
import { MONEY_ACCOUNTS, MONEY_CATEGORIES, MONEY_KINDS, type MoneyKind } from "@/lib/finance-consts";
import { addExpense } from "./actions";

export default function MoneyForm({ defDate, defKind, used }: { defDate: string; defKind: MoneyKind; used: Record<string, string[]> }) {
  const [kind, setKind] = useState<MoneyKind>(defKind);
  const cats = [...new Set([...MONEY_CATEGORIES[kind], ...(used[kind] ?? [])])];
  return (
    <form action={addExpense} className="panel">
      <div className="row" style={{ marginBottom: 8 }}>
        {(Object.keys(MONEY_KINDS) as MoneyKind[]).map((k) => (
          <label key={k} className="check">
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} /> {MONEY_KINDS[k].title}
          </label>
        ))}
      </div>
      <div className="row">
        <label>
          Дата
          <input type="date" name="date" defaultValue={defDate} required />
        </label>
        <label>
          Стаття
          <input key={kind} name="category" list={`cats-${kind}`} required placeholder="оберіть або впишіть" style={{ width: 260 }} />
          <datalist id={`cats-${kind}`}>
            {cats.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label>
          Сума, грн
          <input name="amount" type="number" min={0.01} step="0.01" required style={{ width: 120 }} />
        </label>
        <label>
          Рахунок
          <select name="account" defaultValue={MONEY_ACCOUNTS[0]}>
            {MONEY_ACCOUNTS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Примітка
          <input name="note" placeholder="напр. за 1–15 листопада" />
        </label>
        <button className="btn primary">Записати</button>
      </div>
    </form>
  );
}
