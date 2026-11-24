/**
 * Завантаження з серверів постачальників, у яких неповний SSL-ланцюжок (не віддають проміжний сертифікат).
 * Браузер такий сайт відкриває (сам докачує проміжний сертифікат), а Node — ні: UNABLE_TO_VERIFY_LEAF_SIGNATURE.
 * Робимо як браузер: беремо з сертифіката сайту адресу видавця (AIA «CA Issuers»), докачуємо проміжний
 * сертифікат і перевіряємо з’єднання звичайними кореневими сертифікатами + ним. Перевірка не вимикається.
 */
import https from "node:https";
import http from "node:http";
import tls from "node:tls";
import zlib from "node:zlib";
import { X509Certificate } from "node:crypto";

export type Got = { status: number; type: string; body: Buffer };

const CHAIN_ERRORS = ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT"];
const extraCa = new Map<string, string[]>(); // host:port → докачані проміжні сертифікати (PEM)

const errCode = (e: unknown) => {
  const c = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  return c ?? "";
};

const aiaUrl = (info: string | undefined) => info?.match(/CA Issuers - URI:(\S+)/)?.[1] ?? null;

function peerCert(host: string, port: number): Promise<X509Certificate> {
  return new Promise((resolve, reject) => {
    // лише прочитати сертифікат сайту (дані не передаємо)
    const s = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 15000 }, () => {
      const raw = s.getPeerCertificate().raw;
      s.end();
      raw ? resolve(new X509Certificate(raw)) : reject(new Error("сервер не надав сертифікат"));
    });
    s.on("error", reject);
    s.on("timeout", () => s.destroy(new Error("таймаут TLS")));
  });
}

async function downloadCert(url: string): Promise<X509Certificate> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`сертифікат видавця: ${r.status}`);
  return new X509Certificate(Buffer.from(await r.arrayBuffer()));
}

async function missingChain(host: string, port: number) {
  const key = `${host}:${port}`;
  const cached = extraCa.get(key);
  if (cached) return cached;
  const pems: string[] = [];
  let cert = await peerCert(host, port);
  for (let i = 0; i < 3; i++) {
    const url = aiaUrl(cert.infoAccess);
    if (!url) break;
    const issuer = await downloadCert(url);
    pems.push(issuer.toString());
    if (issuer.issuer === issuer.subject) break; // дійшли до кореневого
    cert = issuer;
  }
  if (!pems.length) throw new Error("у сертифіката сайту немає адреси видавця (AIA) — попросіть постачальника виправити SSL");
  extraCa.set(key, pems);
  return pems;
}

function nodeGet(url: string, ca: string[] | null, timeoutMs: number, redirects = 3): Promise<Got> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.get(
      u,
      { headers: { "accept-encoding": "gzip, deflate", "user-agent": "Mozilla/5.0 sklad" }, ...(ca ? { ca: [...tls.rootCertificates, ...ca] } : {}), timeout: timeoutMs },
      (res) => {
        const loc = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc && redirects > 0) {
          res.resume();
          return resolve(nodeGet(new URL(loc, url).toString(), ca, timeoutMs, redirects - 1));
        }
        const chunks: Buffer[] = [];
        const enc = res.headers["content-encoding"];
        const stream = enc === "gzip" ? res.pipe(zlib.createGunzip()) : enc === "deflate" ? res.pipe(zlib.createInflate()) : res;
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
        stream.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("таймаут")));
    req.on("error", reject);
  });
}

/** fetch, а якщо сервер має неповний SSL-ланцюжок — повтор із докачаним проміжним сертифікатом */
export async function robustGet(url: string, timeoutMs = 60000): Promise<Got> {
  const u = new URL(url);
  const port = Number(u.port) || 443;
  const known = extraCa.get(`${u.hostname}:${port}`);
  if (known) return nodeGet(url, known, timeoutMs);
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return { status: r.status, type: r.headers.get("content-type") ?? "", body: Buffer.from(await r.arrayBuffer()) };
  } catch (e) {
    if (u.protocol !== "https:" || !CHAIN_ERRORS.includes(errCode(e))) throw e;
    const ca = await missingChain(u.hostname, port);
    return nodeGet(url, ca, timeoutMs);
  }
}
