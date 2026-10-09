import { z } from "zod";
import { warnDiagnostic } from "../../../lib/agent21/diagnostics";

// Live figures for two landing-page examples: the current block height (the
// halving example and the transaction's confirmations) from BRK, and
// Polymarket's yearly "What price will Bitcoin hit" ladder. Each is cached for
// an hour and falls back to the snapshot below, logged, when its source is
// unavailable.

const HOUR = 3600;
const TIMEOUT_MS = 3000;
// BRK's Cloudflare rejects some default clients, so requests name the site.
const HEADERS = {
  "User-Agent":
    "SecretSatoshis-Agent21/1.0 (+https://agent21.secretsatoshis.com)",
};

export type ChainHeight = { height: number; retrievedAt: string };

/** A daily close: the strikes either side of it make the ladder. */
export type Close = { date: string; price: number };

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
