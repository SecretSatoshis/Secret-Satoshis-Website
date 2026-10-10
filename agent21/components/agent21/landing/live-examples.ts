import { z } from "zod";
import { warnDiagnostic } from "../../../lib/agent21/diagnostics";

// Live figures for the landing-page examples: Bitcoin's price now, its
// realized prices and the current block height (the halving example and the
// transaction's confirmations) from BRK, and Polymarket's yearly "What price
// will Bitcoin hit" ladder. The price and the realized prices are read on
// every visit and fall back to the daily release's; the others are cached
// for an hour and fall back to the snapshot below. Each fallback is logged.

const HOUR = 3600;
const TIMEOUT_MS = 3000;
// BRK's Cloudflare rejects some default clients, so requests name the site.
const HEADERS = {
  "User-Agent":
    "SecretSatoshis-Agent21/1.0 (+https://agent21.secretsatoshis.com)",
};

export type ChainHeight = { height: number; retrievedAt: string };

/** Bitcoin's price on `date`: BRK's live price, read at `at`, or the daily
 * release's close for that day (no `at`). The strikes either side of it make
 * the ladder. */
export type Close = { date: string; price: number; at?: string };

export type PriceOdds = {
  year: number;
  title: string;
  slug: string;
  volume: number;
  liquidity: number;
  retrievedAt: string;
  /** The close the strikes were chosen against, shown on the ladder. */
  close: Close;
  /** Open strikes as odds in percent, highest price first within each side. */
  up: { price: number; odds: number }[];
  down: { price: number; odds: number }[];
};

export const SNAPSHOT_HEIGHT: ChainHeight = {
  height: 970543,
  retrievedAt: "2026-10-08T23:52:00Z",
};

export const SNAPSHOT_ODDS: PriceOdds = {
  year: 2026,
  title: "What price will Bitcoin hit in 2026?",
  slug: "what-price-will-bitcoin-hit-before-2027",
  volume: 74227369,
  liquidity: 4255770,
  retrievedAt: "2026-10-08T23:52:00Z",
  close: { date: "2026-10-07", price: 83172 },
  up: [
    { price: 150000, odds: 2.8 },
    { price: 140000, odds: 3.1 },
    { price: 130000, odds: 4.4 },
    { price: 120000, odds: 7.5 },
    { price: 110000, odds: 11.5 },
    { price: 100000, odds: 26.5 },
    { price: 95000, odds: 39.5 },
    { price: 90000, odds: 59 },
  ],
  down: [
    { price: 70000, odds: 39.5 },
    { price: 65000, odds: 23.5 },
    { price: 60000, odds: 15.5 },
    { price: 55000, odds: 11 },
    { price: 50000, odds: 7.5 },
  ],
};

const retrievedAt = (response: Response) => {
  const date = new Date(response.headers.get("date") ?? Date.now());
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
};

function fellBack<T>(snapshot: T, code: string, status?: number) {
  warnDiagnostic({ code, status }, "landing_fallback", { provider: "source" });
  return snapshot;
}

async function fetchCached(url: string) {
  return fetch(url, {
    headers: HEADERS,
    cache: "force-cache",
    next: { revalidate: HOUR },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** BRK's current block height, or the snapshot. */
export async function loadChainHeight(): Promise<ChainHeight> {
  try {
    const response = await fetchCached(
      "https://bitview.space/api/blocks/tip/height",
    );
    const height = Number((await response.text()).trim());
    if (
      !response.ok ||
      !Number.isInteger(height) ||
      height < SNAPSHOT_HEIGHT.height
    )
      return fellBack(
        SNAPSHOT_HEIGHT,
        "block_height_unavailable",
        response.status,
      );
    return { height, retrievedAt: retrievedAt(response) };
  } catch {
    return fellBack(SNAPSHOT_HEIGHT, "block_height_unavailable");
  }
}

const PRICE_URL = "https://bitview.space/api/v1/prices";
// A live price older than this, or this many times above or below the
// release's close, is a stale or bad reply; the close stands in for it.
const PRICE_MAX_AGE_MS = 6 * HOUR * 1000;
const PRICE_MAX_MOVE = 1.5;

const priceSchema = z.object({
  time: z.number().int().positive(),
  USD: z.number().positive().finite(),
});

/** BRK's price reply as a `Close` dated by its UTC day, or null when it is
 * stale, from the future, in another year than `close` or implausibly far
 * from it. */
export function livePrice(
  reply: unknown,
  close: Close,
  now = Date.now(),
): Close | null {
  const parsed = priceSchema.safeParse(reply);
  if (!parsed.success) return null;
  const at = new Date(parsed.data.time * 1000);
  const age = now - at.getTime();
  const move = parsed.data.USD / close.price;
  const date = at.toISOString().slice(0, 10);
  if (
    age > PRICE_MAX_AGE_MS ||
    age < -10 * 60 * 1000 ||
    move > PRICE_MAX_MOVE ||
    move < 1 / PRICE_MAX_MOVE ||
    date.slice(0, 4) !== close.date.slice(0, 4)
  )
    return null;
  return { date, price: parsed.data.USD, at: at.toISOString() };
}

/** Bitcoin's price now from BRK, read on every visit, or `close` when BRK's
 * price is unavailable or fails the checks in livePrice(). The request starts
 * before `close` resolves. */
export async function loadPrice(close: Close | Promise<Close>): Promise<Close> {
  try {
    const response = await fetch(PRICE_URL, {
      headers: HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const reply = response.ok ? await response.json() : null;
    return (
      livePrice(reply, await close) ??
      fellBack(await close, "live_price_unavailable", response.status)
    );
  } catch {
    return fellBack(await close, "live_price_unavailable");
  }
}

/** BRK's realized price and STH realized price at block `height`, read at `at`. */
export type RealizedLevels = {
  realized: number;
  sth: number;
  height: number;
  at: string;
};

// The release's levels are a day old at most, and realized prices move
// slowly: a live level this far from the release's is a bad reply.
const LEVEL_MAX_MOVE = 1.1;

const tipSeriesSchema = z.object({
  index: z.literal("height"),
  start: z.number().int().positive(),
  data: z.tuple([z.number().positive().finite()]),
  stamp: z.string(),
});

/** The two levels from BRK's series replies, or null when either is
 * malformed, they are blocks apart or either strays from `release`'s. */
export function realizedLevels(
  realizedReply: unknown,
  sthReply: unknown,
  release: { realized: number; sth: number },
): RealizedLevels | null {
  const realized = tipSeriesSchema.safeParse(realizedReply);
  const sth = tipSeriesSchema.safeParse(sthReply);
  if (!realized.success || !sth.success) return null;
  const near = (value: number, to: number) =>
    value < to * LEVEL_MAX_MOVE && value > to / LEVEL_MAX_MOVE;
  const at = new Date(realized.data.stamp);
  if (
    Math.abs(realized.data.start - sth.data.start) > 1 ||
    !near(realized.data.data[0], release.realized) ||
    !near(sth.data.data[0], release.sth) ||
    Number.isNaN(at.getTime())
  )
    return null;
  return {
    realized: realized.data.data[0],
    sth: sth.data.data[0],
    height: Math.max(realized.data.start, sth.data.start),
    at: at.toISOString(),
  };
}

/** BRK's realized price and STH realized price now, read on every visit, or
 * null (the release's levels stand) when they fail the checks in
 * realizedLevels(). The requests start before `release` resolves. */
export async function loadRealizedLevels(
  release: Promise<{ realized: number; sth: number }>,
): Promise<RealizedLevels | null> {
  try {
    const [realized, sth] = await Promise.all(
      ["realized_price", "sth_realized_price"].map(async (name) => {
        const response = await fetch(
          `https://bitview.space/api/series/${name}/height?start=-1`,
          {
            headers: HEADERS,
            cache: "no-store",
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
        return response.ok ? response.json() : null;
      }),
    );
    return (
      realizedLevels(realized, sth, await release) ??
      fellBack(null, "realized_levels_unavailable")
    );
  } catch {
    return fellBack(null, "realized_levels_unavailable");
  }
}

const UP_STRIKES = 8;
const DOWN_STRIKES = 5;
// A market at this price has been touched and is waiting to resolve.
const TOUCHED = 0.985;

const eventSchema = z.object({
  title: z.string(),
  slug: z.string(),
  volume: z.coerce.number(),
  liquidity: z.coerce.number(),
  closed: z.boolean(),
  markets: z.array(
    z.object({
      groupItemTitle: z.string().nullish(),
      outcomePrices: z.string().nullish(),
      closed: z.boolean().nullish(),
    }),
  ),
});

/** The open strikes on either side of `close`, from the event's markets.
 * Each market's first outcome is "Yes"; its price is the market's odds. */
export function priceOddsFromEvent(
  event: unknown,
  year: number,
  close: Close,
  at: string,
): PriceOdds | null {
  const parsed = eventSchema.safeParse(event);
  if (!parsed.success || parsed.data.closed) return null;
  const strikes: { side: "up" | "down"; price: number; odds: number }[] = [];
  for (const market of parsed.data.markets) {
    const match = market.groupItemTitle?.match(/^\s*([↑↓])\s*([\d,]+)\s*$/);
    if (market.closed || !match || !market.outcomePrices) continue;
    let yes: number;
    try {
      yes = Number(JSON.parse(market.outcomePrices)[0]);
    } catch {
      continue;
    }
    const price = Number(match[2].replaceAll(",", ""));
    const side = match[1] === "↑" ? "up" : "down";
    if (!Number.isFinite(yes) || yes <= 0 || yes >= TOUCHED) continue;
    if (side === "up" ? price <= close.price : price >= close.price) continue;
    strikes.push({ side, price, odds: Math.round(yes * 1000) / 10 });
  }
  const up = strikes
    .filter((s) => s.side === "up")
    .sort((a, b) => a.price - b.price)
    .slice(0, UP_STRIKES)
    .reverse();
  const down = strikes
    .filter((s) => s.side === "down")
    .sort((a, b) => b.price - a.price)
    .slice(0, DOWN_STRIKES);
  if (up.length < 2 || down.length < 2) return null;
  const row = ({ price, odds }: { price: number; odds: number }) => ({
    price,
    odds,
  });
  return {
    year,
    title: parsed.data.title,
    slug: parsed.data.slug,
    volume: parsed.data.volume,
    liquidity: parsed.data.liquidity,
    retrievedAt: at,
    close,
    up: up.map(row),
    down: down.map(row),
  };
}

/** This year's Polymarket price ladder around `close`, or the snapshot with
 * its own close. The request starts before `close` resolves. */
export async function loadPriceOdds(
  close: Close | Promise<Close>,
): Promise<PriceOdds> {
  const year = new Date().getUTCFullYear();
  try {
    const response = await fetchCached(
      `https://gamma-api.polymarket.com/events/slug/what-price-will-bitcoin-hit-before-${year + 1}`,
    );
    if (!response.ok)
      return fellBack(SNAPSHOT_ODDS, "price_odds_unavailable", response.status);
    const event = await response.json();
    return (
      priceOddsFromEvent(event, year, await close, retrievedAt(response)) ??
      fellBack(SNAPSHOT_ODDS, "price_odds_unavailable")
    );
  } catch {
    return fellBack(SNAPSHOT_ODDS, "price_odds_unavailable");
  }
}
