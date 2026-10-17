import { gunzipSync } from "node:zlib";
import { cached } from "./cache";

// Public sources the data tools read. Every fetch is GET-only, bounded in size
// and time, retried once on a rate limit or gateway error, and recorded in the
// tool context so the evals can see exactly which URLs a tool sent out.
const USER_AGENT = "SecretSatoshis-Agent21/0.4";
const RETRY = new Set([429, 502, 503, 504]);
// Secret Satoshis' daily files, charts and newsletter change at most daily;
// live sources (BRK, Polymarket) are kept for seconds so readings stay live.
const DAILY_HOSTS = new Set([
  "secretsatoshis.github.io",
  "charts.secretsatoshis.com",
  "newsletter.secretsatoshis.com",
]);

export type FetchLog = { url: string; status: number; ms: number }[];
export class SourceError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

type Options = {
  maxBytes?: number;
  timeoutMs?: number;
  /** Seconds a response stays cached; defaults by host (15 min daily, 30 s live). */
  ttl?: number;
  log?: FetchLog;
};

async function once(url: string, timeoutMs: number) {
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** The bytes of a public URL, unpacked when gzipped. */
export async function fetchBytes(url: string, options: Options = {}) {
  const { maxBytes = 16 * 1024 ** 2, timeoutMs = 15_000, log } = options;
  const host = new URL(url).hostname;
  const ttl = options.ttl ?? (DAILY_HOSTS.has(host) ? 900 : 30);
  return cached(
    `bytes:${url}`,
    ttl,
    async () => {
      const started = Date.now();
      let response = await once(url, timeoutMs);
      if (RETRY.has(response.status)) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        response = await once(url, timeoutMs);
      }
      log?.push({ url, status: response.status, ms: Date.now() - started });
      if (!response.ok) {
        // Sources explain a refusal in the body (BRK names close series), which
        // lets the model correct its request instead of repeating it.
        const detail = (await response.text().catch(() => ""))
          .slice(0, 400)
          .trim();
        throw new SourceError(
          `${host} answered ${response.status}${detail ? `: ${detail}` : ""}`,
          response.status,
        );
      }
      const length = Number(response.headers.get("content-length") || 0);
      if (length > maxBytes)
        throw new SourceError(`${host}: response too large`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > maxBytes)
        throw new SourceError(`${host}: response too large`);
      return data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data;
    },
    () => log?.push({ url, status: 200, ms: 0 }),
  );
}

export const fetchText = async (url: string, options?: Options) =>
  (await fetchBytes(url, options)).toString("utf8");

export const fetchJson = async <T = unknown>(url: string, options?: Options) =>
  JSON.parse(await fetchText(url, options)) as T;
