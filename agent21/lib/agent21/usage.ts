import { sql } from "kysely";
import { db } from "./db";
import { AppError } from "./errors";
import { environmentId, isProviderError, openai } from "./openai";

// USD per million tokens (October 2026). "auto" and "default" bill as standard.
// Almost all uncached input is billed as cache writes (OpenAI's charges show
// plain input at 1-2% of it), so uncached input is priced at that rate.
export const PRICES: Record<
  string,
  Record<
    "standard" | "flex",
    { cacheWrite: number; cached: number; output: number }
  >
> = {
  "gpt-6-luna": {
    standard: { cacheWrite: 0.125, cached: 0.01, output: 0.5 },
    flex: { cacheWrite: 0.0625, cached: 0.005, output: 0.25 },
  },
  "gpt-6.1-sol": {
    standard: { cacheWrite: 2.5, cached: 0.1, output: 10 },
    flex: { cacheWrite: 1.25, cached: 0.05, output: 5 },
  },
};
// A model missing from the table is priced as the dearest one, so an unpriced
// model can only overstate spend against the allowance.
const FALLBACK_MODEL = "gpt-6.1-sol";
// USD per sandbox minute, billed by the minute with a five-minute minimum:
// cold sessions run small (1 GB), pre-warmed sandboxes medium (4 GB).
export const SANDBOX_USD_PER_MINUTE = { small: 0.03 / 20, medium: 0.12 / 20 };
const SANDBOX_MINIMUM_MINUTES = 5;
// USD per web search call; its content tokens are already in the token counts.
export const SEARCH_USD = 10 / 1000;

/** The beta allowance per account, in USD (AGENT21_SPEND_LIMIT_USD, default 10). */
export function spendLimitUsd() {
  const value = Number(process.env.AGENT21_SPEND_LIMIT_USD ?? 10);
  return Number.isFinite(value) && value > 0 ? value : 10;
}

type Priced = {
  model: string | null;
  tier: string | null;
  input: number;
  cached: number;
  output: number;
  searches: number;
  size: "small" | "medium";
  seconds: number;
};
const round = (n: number) => Math.round(n * 1e6) / 1e6;
/** Estimated USD for a session's tokens, searches and sandbox time. */
export function priceUsage(u: Priced) {
  const price = PRICES[u.model ?? ""] ?? PRICES[FALLBACK_MODEL]!;
  const rates = price[u.tier === "flex" ? "flex" : "standard"];
  const modelUsd =
    ((u.input - u.cached) * rates.cacheWrite +
      u.cached * rates.cached +
      u.output * rates.output) /
    1e6;
  const searchUsd = u.searches * SEARCH_USD;
  const sandboxUsd =
    Math.max(SANDBOX_MINIMUM_MINUTES, u.seconds / 60) *
    SANDBOX_USD_PER_MINUTE[u.size];
  return {
    model_usd: round(modelUsd),
    search_usd: round(searchUsd),
    sandbox_usd: round(sandboxUsd),
    cost_usd: round(modelUsd + searchUsd + sandboxUsd),
  };
}

/** A pre-warmed sandbox starts billing when created; a session that attaches it takes the row over. */
export async function recordWarmSandbox(owner: string, environment: string) {
  const now = new Date();
  await db()
    .insertInto("agent21_usage")
    .values({
      id: environment,
      kind: "warm",
      owner_id: owner,
      sandbox_size: "medium",
      sandbox_started_at: now,
      sandbox_last_at: now,
      ...priceUsage({
        model: null,
        tier: null,
        input: 0,
        cached: 0,
        output: 0,
        searches: 0,
        size: "medium",
        seconds: 0,
      }),
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}

async function webSearches(session: string) {
  let count = 0;
  for await (const item of openai().beta.agents.sessions.items.list(session))
    if ((item as { type?: string }).type === "web_search_call") count++;
  return count;
}

/**
 * Brings a session's row up to date after a turn: its cumulative tokens, web
 * searches and sandbox time so far. OpenAI fills token usage a few seconds
 * after a turn, so a row may stay pending until a later refresh.
 */
export async function recordSessionUsage(
  owner: string,
  conversation: string,
  sessionId: string,
) {
  const api = openai();
  let session;
  try {
    session = await api.beta.agents.sessions.retrieve(sessionId);
  } catch (error) {
    if (isProviderError(error, 404)) return;
    throw error;
  }
  const existing = await db()
    .selectFrom("agent21_usage")
    .selectAll()
    .where("id", "=", sessionId)
    .executeTakeFirst();
  // The first record of a session: a pre-warmed sandbox it attached is billed
  // from the sandbox's start, so its warm row is folded into the session's.
  let size: "small" | "medium" = "small";
  let started = new Date(session.created_at * 1000);
  if (existing) {
    size = existing.sandbox_size as "small" | "medium";
    started = new Date(existing.sandbox_started_at);
  } else {
    const warm = await db()
      .deleteFrom("agent21_usage")
      .where("id", "=", environmentId(session))
      .where("kind", "=", "warm")
      .returning("sandbox_started_at")
      .executeTakeFirst();
    if (warm) {
      size = "medium";
      started = new Date(warm.sandbox_started_at);
    }
  }
  const usage = session.usage;
  const tokens = usage
    ? {
        input: usage.input_tokens,
        cached: usage.input_tokens_details.cached_tokens,
        output: usage.output_tokens,
        reasoning: usage.output_tokens_details.reasoning_tokens,
      }
    : {
        input: Number(existing?.input_tokens ?? 0),
        cached: Number(existing?.cached_tokens ?? 0),
        output: Number(existing?.output_tokens ?? 0),
        reasoning: Number(existing?.reasoning_tokens ?? 0),
      };
  const searches = await webSearches(sessionId);
  const now = new Date();
  const values = {
    kind: "session" as const,
    owner_id: owner,
    conversation_id: conversation,
    model: session.agent.model,
    service_tier: session.agent.service_tier,
    input_tokens: tokens.input,
    cached_tokens: tokens.cached,
    output_tokens: tokens.output,
    reasoning_tokens: tokens.reasoning,
    web_searches: searches,
    sandbox_size: size,
    sandbox_started_at: started,
    sandbox_last_at: now,
    usage_pending: !usage,
    updated_at: now,
    ...priceUsage({
      model: session.agent.model,
      tier: session.agent.service_tier,
      ...tokens,
      searches,
      size,
      seconds: (now.getTime() - started.getTime()) / 1000,
    }),
  };
  await db()
    .insertInto("agent21_usage")
    .values({ id: sessionId, ...values })
    .onConflict((oc) => oc.column("id").doUpdateSet(values))
    .execute();
}

/** Fills rows whose token usage OpenAI had not reported yet. */
async function settlePending(owner: string) {
  const pending = await db()
    .selectFrom("agent21_usage")
    .select(["id", "conversation_id"])
    .where("owner_id", "=", owner)
    .where("usage_pending", "=", true)
    .limit(5)
    .execute();
  for (const row of pending) {
    try {
      const session = await openai().beta.agents.sessions.retrieve(row.id);
      if (!session.usage) continue;
      const priced = {
        model: session.agent.model,
        tier: session.agent.service_tier,
        input: session.usage.input_tokens,
        cached: session.usage.input_tokens_details.cached_tokens,
        output: session.usage.output_tokens,
      };
      const current = await db()
        .selectFrom("agent21_usage")
        .selectAll()
        .where("id", "=", row.id)
        .executeTakeFirstOrThrow();
      const seconds =
        (new Date(current.sandbox_last_at).getTime() -
          new Date(current.sandbox_started_at).getTime()) /
        1000;
      await db()
        .updateTable("agent21_usage")
        .set({
          input_tokens: priced.input,
          cached_tokens: priced.cached,
          output_tokens: priced.output,
          reasoning_tokens:
            session.usage.output_tokens_details.reasoning_tokens,
          usage_pending: false,
          updated_at: new Date(),
          ...priceUsage({
            ...priced,
            searches: current.web_searches,
            size: current.sandbox_size as "small" | "medium",
            seconds,
          }),
        })
        .where("id", "=", row.id)
        .execute();
    } catch (error) {
      // A deleted session reports nothing more; its last counts stand.
      if (!isProviderError(error, 404)) throw error;
      await db()
        .updateTable("agent21_usage")
        .set({ usage_pending: false })
        .where("id", "=", row.id)
        .execute();
    }
  }
}

/** The account's estimated spend so far against its allowance. */
export async function spendSummary(owner: string) {
  await settlePending(owner).catch(() => undefined);
  const row = await db()
    .selectFrom("agent21_usage")
    .select(sql<string>`coalesce(sum(cost_usd), 0)`.as("spent"))
    .where("owner_id", "=", owner)
    .executeTakeFirstOrThrow();
  return {
    spentUsd: Math.round(Number(row.spent) * 100) / 100,
    limitUsd: spendLimitUsd(),
  };
}

/** New answers and pre-warmed sandboxes stop once the allowance is used. */
export async function withinAllowance(owner: string) {
  const { spentUsd, limitUsd } = await spendSummary(owner);
  return spentUsd < limitUsd;
}
export async function assertWithinAllowance(owner: string) {
  if (!(await withinAllowance(owner)))
    throw new AppError(
      402,
      `You've used this beta's $${spendLimitUsd()} allowance for Agent 21. Your history stays available.`,
      "spend_limit",
    );
}
