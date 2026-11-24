import { db } from "@/lib/db";
import { manualRates } from "@/lib/currency";
import { dateTimeUa } from "@/lib/util";
import { setRate } from "@/app/(app)/suppliers/actions";

/** Блок «Курс на сьогодні»: власник вводить курс щодня; ціни з РРЦ перераховуються автоматично */
export default async function RateForm({ back = "/suppliers", codes = ["USD"] }: { back?: string; codes?: string[] }) {
  const [manual, rows] = await Promise.all([manualRates(), db.currency.findMany()]);
  const today = new Date().toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" });
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Курс на сьогодні</h2>
      {codes.map((code) => {
        const m = manual[code];
        const cur = rows.find((r) => r.code === code)?.rate;
        const fresh = m && new Date(m.at).toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" }) === today;
        return (
          <form key={code} action={setRate} className="row" style={{ marginBottom: 8 }}>
            <input type="hidden" name="code" value={code} />
            <input type="hidden" name="back" value={back} />
            <b style={{ minWidth: 60 }}>1 {code} =</b>
            <input name="rate" defaultValue={cur ?? ""} inputMode="decimal" style={{ width: 100 }} required />
            <span>грн</span>
            <button className="btn sm">Зберегти курс</button>
            <span className={`small ${fresh ? "muted" : ""}`} style={fresh ? undefined : { color: "#b45309" }}>
              {m ? `введено ${dateTimeUa(new Date(m.at))}${fresh ? "" : " — оновіть на сьогодні"}` : "зараз курс SalesDrive — введіть свій"}
            </span>
          </form>
        );
      })}
      <p className="small muted" style={{ marginBottom: 0 }}>
        Курс застосовується до нових приходів (собівартість у гривні фіксується на день приходу) і до цін продажу з РРЦ: ціна = РРЦ × курс, округлено
        вгору. Змінені ціни одразу йдуть у SalesDrive → сайт і Prom. Товари з ціною, зафіксованою вручну, не змінюються.
      </p>
    </div>
  );
}
