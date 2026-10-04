import Ajv from "ajv";
import { getCache } from "@vercel/functions";
import catalog from "./contracts/operations.json";
import { AppError } from "./errors";
const ajv = new Ajv({ strict: false, allErrors: true });
const operations = new Map(
  catalog.operations.map((op) => [
    op.name,
    { ...op, validate: ajv.compile(op.schema) },
  ]),
);
const allowedHosts = new Set([
  "bitview.space",
  "mempool.space",
  "gamma-api.polymarket.com",
  "api.github.com",
]);
export function toolRequest(name: string, args: unknown) {
  const op = operations.get(name);
  if (!op || !op.validate(args))
    throw new AppError(400, "Invalid source request.");
  const parameters = args as Record<string, string | number | boolean>;
  let path = op.path;
  for (const p of op.parameters) {
    const value = parameters[p.name];
    if (value === undefined) continue;
    if (p.in === "path") {
      if (
        String(value).includes("..") ||
        String(value).includes("\\") ||
        String(value).includes("%")
      )
        throw new AppError(400, "Invalid source path.");
      path = path.replace(
        `{${p.name}}`,
        p.name === "path"
          ? String(value).split("/").map(encodeURIComponent).join("/")
          : encodeURIComponent(String(value)),
      );
    }
  }
  const url = new URL(`${op.base}${path}`);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname))
    throw new AppError(400, "Source is not allowed.");
  for (const p of op.parameters)
    if (p.in === "query" && parameters[p.name] !== undefined)
      url.searchParams.set(p.name, String(parameters[p.name]));
  return {
    url,
    privateQuery:
      path.includes("/address/") || path.includes("/validate-address/"),
  };
}
export async function boundedBytes(response: Response, max: number) {
  if (Number(response.headers.get("content-length") || 0) > max)
    throw new AppError(413, "The source response is too large.");
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max)
        throw new AppError(413, "The source response is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
type SourceResult = {
  text: string;
  source: string;
  retrieved_at: string;
  content_type: string;
};
// Vercel's runtime cache is shared by every instance in a region; outside
// Vercel the SDK falls back to an in-memory cache.
const cache = () => getCache({ namespace: "agent21-sources" });
const retryable = new Set([429, 502, 503, 504]);
function retryAfter(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? ms : undefined;
}
function sourceHeaders(url: URL) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "SecretSatoshis-Agent21/1.0",
  };
  // Authenticated GitHub requests get 5,000 calls an hour instead of 60.
  if (url.hostname === "api.github.com") {
    headers["X-GitHub-Api-Version"] = "2022-11-28";
    if (process.env.AGENT21_GITHUB_TOKEN)
      headers.Authorization = `Bearer ${process.env.AGENT21_GITHUB_TOKEN}`;
  }
  return headers;
}
/** Retries a rate-limited or briefly unavailable source twice, within 20 seconds. */
async function fetchSource(url: URL, fetcher: typeof fetch) {
  const deadline = Date.now() + 20_000;
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(url, {
      redirect: "error",
      signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
      headers: sourceHeaders(url),
    });
    if (!retryable.has(response.status) || attempt === 2) return response;
    const wait = Math.max(
      0,
      Math.min(5_000, retryAfter(response) ?? 250 * 3 ** attempt),
    );
    if (Date.now() + wait > deadline - 1_000) return response;
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}
export async function retrieveTool(
  name: string,
  args: unknown,
  fetcher: typeof fetch = fetch,
): Promise<SourceResult> {
  const { url, privateQuery } = toolRequest(name, args);
  if (!privateQuery) {
    const cached = await cache()
      .get(url.href)
      .catch(() => null);
    if (cached) return cached as SourceResult;
  }
  const response = await fetchSource(url, fetcher);
  if (!response.ok)
    throw new AppError(
      502,
      "The selected data source is temporarily unavailable.",
    );
  let text = (await boundedBytes(response, 4 * 1024 ** 2)).toString("utf8");
  const contentType = response.headers.get("content-type") || "text/plain";
  if (contentType.includes("json")) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new AppError(502, "The source returned malformed data.");
    }
    if (url.hostname === "api.github.com" && !Array.isArray(data)) {
      if (
        data.type !== "file" ||
        data.size > 1_048_576 ||
        data.encoding !== "base64"
      )
        throw new AppError(
          413,
          "Only small public repository files are supported.",
        );
      data = {
        path: data.path,
        html_url: data.html_url,
        sha: data.sha,
        content: Buffer.from(data.content, "base64").toString("utf8"),
      };
    }
    text = JSON.stringify(data);
  }
  const value = {
    text,
    source: url.href,
    retrieved_at: new Date().toISOString(),
    content_type: contentType,
  };
  // Address lookups are never shared between users.
  if (!privateQuery)
    await cache()
      .set(url.href, value, { ttl: 30, name: url.hostname })
      .catch(() => undefined);
  return value;
}
