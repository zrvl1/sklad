// Показує, як виглядають товари у вашому YML із SalesDrive.
// Запуск: npm run yml:inspect
// Корисно, щоб перевірити назви тегів (залишок, собівартість, штрихкод) і за потреби
// поправити функцію parseYml у src/lib/salesdrive.ts.
import { XMLParser } from "fast-xml-parser";

const url = process.env.SALESDRIVE_YML_URL;
if (!url) {
  console.error("Вкажіть SALESDRIVE_YML_URL у .env");
  process.exit(1);
}

const xml = await (await fetch(url)).text();
const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false }).parse(xml);
const shop = doc?.yml_catalog?.shop ?? doc?.shop;
const offers = [].concat(shop?.offers?.offer ?? []);
const cats = [].concat(shop?.categories?.category ?? []);

console.log(`Категорій: ${cats.length}, товарів: ${offers.length}\n`);
console.log("Перші 2 товари як є:\n");
console.log(JSON.stringify(offers.slice(0, 2), null, 2));

const tags = new Set();
for (const o of offers.slice(0, 200)) Object.keys(o).forEach((k) => tags.add(k));
console.log("\nУсі теги, що трапляються в товарах:", [...tags].join(", "));
