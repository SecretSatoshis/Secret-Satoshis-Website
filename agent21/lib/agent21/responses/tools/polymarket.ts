import { ladderBlock, sourcesBlock, tableBlock } from "../blocks";
import { fetchJson, SourceError, type FetchLog } from "../data/http";
import { BRK, thin } from "./brk";
import { opt, s, tool } from "./types";

// Polymarket's public market data (the agent21-polymarket skill). Search ranks
// by total volume and leaves out the off-topic categories; an event is read
// whole, every open outcome with the money behind it.
const GAMMA = "https://gamma-api.polymarket.com";
const DATA = "https://data-api.polymarket.com/v2";
const EXCLUDED_TAGS = [1, 64, 84, 74, 315, 596, 100343];
const CATEGORIES = [
  "crypto",
  "finance",
  "economy",
  "geopolitics",
  "tech",
  "politics",
] as const;

type Market = {
  question: string;
  groupItemTitle?: string;
  outcomes: string | string[];
  outcomePrices: string | string[];
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
  lastTradePrice?: number;
  closed?: boolean;
  acceptingOrders?: boolean;
  volumeNum?: number;
  liquidityNum?: number;
  oneDayPriceChange?: number;
  oneWeekPriceChange?: number;
  oneMonthPriceChange?: number;
  clobTokenIds?: string;
  positionIds?: string | null;
  version?: string;
  description?: string;
  endDate?: string;
};
type Event = {
  id: string;
  slug: string;
  title: string;
  endDate?: string;
  updatedAt?: string;
  negRisk?: boolean;
  closed?: boolean;
  volume?: number;
  liquidity?: number;
  openInterest?: number;
  volume24hr?: number;
  markets: Market[];
};

const list = (value: string | string[] | null | undefined): string[] =>
  Array.isArray(value) ? value : value ? (JSON.parse(value) as string[]) : [];
const odds1 = (p: number) => Math.round(p * 1000) / 10;
const pct = (p: number) => `${odds1(p).toFixed(1)}%`;
const usd = (n?: number) => (n === undefined ? null : Math.round(n));

function yesPrice(m: Market) {
  const outcomes = list(m.outcomes);
  const prices = list(m.outcomePrices).map(Number);
  const i = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  return i >= 0 && Number.isFinite(prices[i]) ? prices[i] : null;
}
function readMarket(m: Market) {
  const yes = yesPrice(m);
  const soft = (m.spread ?? 0) >= 0.1;
  return {
    outcome: m.groupItemTitle || m.question,
    question: m.question,
    yes_midpoint: yes,
    odds: yes === null ? null : pct(yes),
    bid: m.bestBid ?? null,
    ask: m.bestAsk ?? null,
    ...(soft
      ? {
          spread_note:
            "Spread of 0.10 or more: report the bid and ask, not the midpoint.",
        }
      : {}),
    volume_usd: usd(m.volumeNum),
    liquidity_usd: usd(m.liquidityNum),
    change_1d: m.oneDayPriceChange ?? null,
    change_1w: m.oneWeekPriceChange ?? null,
    change_1m: m.oneMonthPriceChange ?? null,
    accepting_orders: m.acceptingOrders ?? null,
  };
}
const STRIKE = /^([↑↓])\s*\$?([\d,]+(?:\.\d+)?)\s*([kK])?$/;

async function event(slug: string, log: FetchLog) {
  if (!/^[a-z0-9-]{1,200}$/.test(slug))
    throw new SourceError(`"${slug}" is not an event slug`);
  return fetchJson<Event>(`${GAMMA}/events/slug/${slug}`, { log });
}

export const polymarket = tool<{
  action: "search" | "event" | "history";
  query: string | null;
  category: (typeof CATEGORIES)[number] | null;
  slug: string | null;
  outcome: string | null;
}>({
  name: "polymarket",
  label: "Checking a data source",
  description:
    "Polymarket prediction markets. search: open events for a short query, ranked by total volume (optionally one category). event: one event read whole by slug: volume, liquidity, open interest, rules and every open outcome's odds, with a ready odds ladder for Bitcoin price strikes or a table for other outcomes. history: one outcome's price history (slug plus the outcome label). Bitcoin price-market slugs: what-price-will-bitcoin-hit-before-<year+1>, what-price-will-bitcoin-hit-in-<month>-<year>, bitcoin-above-on-<month>-<day>-<year>.",
  parameters: s.object({
    action: s.oneOf(["search", "event", "history"], "What to do"),
    query: s.nullable(s.str("Search words, for search")),
    category: s.nullable(s.oneOf(CATEGORIES, "One category, for search")),
    slug: s.nullable(s.str("Event slug, for event and history")),
    outcome: s.nullable(s.str("Outcome label (groupItemTitle), for history")),
  }),
  async run(args, { log, now }) {
    const at = now.toISOString().replace(/\.\d{3}Z$/, "Z");
    if (args.action === "search") {
      if (!args.query?.trim()) throw new SourceError("search needs a query");
      const params = new URLSearchParams({
        optimized: "true",
        search_tags: "false",
        search_profiles: "false",
        sort: "volume",
        ascending: "false",
        limit_per_type: "8",
        q: args.query.trim(),
      });
      for (const tag of EXCLUDED_TAGS)
        params.append("exclude_tag_id", String(tag));
      if (args.category) params.set("events_tag", args.category);
      const found = await fetchJson<{ events?: Event[] }>(
        `${GAMMA}/public-search?${params}`,
        { log },
      );
      const open = (found.events ?? []).filter((e) => !e.closed).slice(0, 6);
      // Search results carry no volume, so the leading events are opened for it.
      const detail = await Promise.all(
        open.slice(0, 4).map((e) => event(e.slug, log).catch(() => null)),
      );
      return {
        retrieved_at: at,
        events: open.map((e, i) => ({
          slug: e.slug,
          title: e.title,
          end_date: e.endDate ?? null,
          multi_outcome: e.negRisk ?? false,
          volume_usd: usd(detail[i]?.volume),
          liquidity_usd: usd(detail[i]?.liquidity),
          leading: e.markets
            .filter((m) => !m.closed)
            .map((m) => ({
              outcome: m.groupItemTitle || m.question,
              yes: yesPrice(m),
            }))
            .filter((m) => m.yes !== null)
            .sort((a, b) => (b.yes ?? 0) - (a.yes ?? 0))
            .slice(0, 4),
        })),
        note: "Open the event you cite for its rules, volume and every outcome.",
      };
    }
    const slug = opt(args.slug);
    if (!slug) throw new SourceError(`${args.action} needs the event slug`);
    const e = await event(slug, log);
    const url = `https://polymarket.com/event/${e.slug}`;
    const sources = sourcesBlock([
      { name: "Polymarket", detail: e.title.slice(0, 60), url, asOf: at },
    ]);
    if (args.action === "history") {
      const m =
        e.markets.find(
          (x) => (x.groupItemTitle || x.question) === args.outcome,
        ) ??
        e.markets.find((x) =>
          (x.groupItemTitle || x.question).includes(args.outcome ?? "\u0000"),
        );
      if (!m)
        throw new SourceError(
          `No outcome "${args.outcome}". Outcomes: ${e.markets.map((x) => x.groupItemTitle || x.question).join(", ")}`,
        );
      const outcomes = list(m.outcomes);
      const tokens = list(
        m.version === "v2" && m.positionIds ? m.positionIds : m.clobTokenIds,
      );
      const token =
        tokens[
          Math.max(
            0,
            outcomes.findIndex((o) => o.toLowerCase() === "yes"),
          )
        ];
      const history = await fetchJson<{
        data: { timestamp: number; price: number }[];
      }>(
        `${DATA}/prices-history?${new URLSearchParams({ token_id: token, interval: "max" })}`,
        { log },
      );
      const points = history.data.map((p) => ({
        time: new Date(p.timestamp * 1000).toISOString().slice(0, 16) + "Z",
        yes: p.price,
      }));
      const thinned = thin(points, 120);
      return {
        event: e.title,
        outcome: m.groupItemTitle || m.question,
        points: thinned.rows,
        total_points: points.length,
        ...(thinned.note ? { note: thinned.note } : {}),
        blocks: { sources },
      };
    }
    const open = e.markets.filter((m) => !m.closed && yesPrice(m) !== null);
    const markets = open.map(readMarket);
    const result: Record<string, unknown> = {
      retrieved_at: at,
      slug: e.slug,
      title: e.title,
      url,
      multi_outcome: e.negRisk ?? false,
      end_date: e.endDate ?? null,
      updated_at: e.updatedAt ?? null,
      volume_usd: usd(e.volume),
      liquidity_usd: usd(e.liquidity),
      open_interest_usd: usd(e.openInterest),
      volume_24h_usd: usd(e.volume24hr),
      rules: (e.markets[0]?.description ?? "").slice(0, 1500),
      closed_outcomes: e.markets.length - open.length,
      outcomes: markets,
    };
    const blocks: Record<string, string> = { sources };
    const strikes = open
      .map((m) => ({ m, match: STRIKE.exec((m.groupItemTitle ?? "").trim()) }))
      .filter((x) => x.match);
    if (
      strikes.length >= 2 &&
      strikes.length === open.length &&
      e.volume !== undefined
    ) {
      const price = await fetchJson<{ USD: number }>(`${BRK}/api/v1/prices`, {
        log,
      });
      const levels = strikes
        .map(({ m, match }) => ({
          value: Number(match![2].replace(/,/g, "")) * (match![3] ? 1000 : 1),
          label: `${match![1] === "↑" ? "Reach" : "Dip to"} $${match![2]}${match![3] ?? ""}`,
          odds: odds1(yesPrice(m)!),
        }))
        .sort((a, b) => a.value - b.value);
      result.bitcoin_price_now = { usd: price.USD, source: "BRK" };
      blocks.ladder = ladderBlock(e.title.slice(0, 80), price.USD, levels, {
        measure: "odds",
        nowLabel: "BTC now",
        market: {
          name: e.title.slice(0, 120),
          url,
          volume: e.volume,
          liquidity: e.liquidity ?? 0,
        },
      });
    } else if (markets.length) {
      const rows = [...markets]
        .sort((a, b) => (b.yes_midpoint ?? 0) - (a.yes_midpoint ?? 0))
        .slice(0, 20)
        .map((m) => [m.outcome.slice(0, 80), m.odds ?? "—"]);
      blocks.table = tableBlock(
        rows,
        [{ label: "Outcome" }, { label: "Odds", format: "text" }],
        e.title.slice(0, 80),
        `Midpoints, retrieved ${at.slice(0, 16).replace("T", " ")} UTC.`,
      );
    }
    return { ...result, blocks };
  },
});
