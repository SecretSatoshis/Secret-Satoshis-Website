import { sql } from "kysely";
import { db } from "../lib/agent21/db";
import { spendLimitUsd } from "../lib/agent21/usage";

// Estimated spend from agent21_usage (lib/agent21/usage.ts): per account, per
// conversation and per OpenAI session. Estimates price tokens, web searches and
// sandbox minutes; `ops report` shows OpenAI's actual daily charges to check them.
const usd = (n: unknown) => Math.round(Number(n) * 10000) / 10000;

export async function costReport(filter: {
  user?: string;
  conversation?: string;
}) {
  let rows = db().selectFrom("agent21_usage");
  if (filter.user) rows = rows.where("owner_id", "=", filter.user);
  if (filter.conversation)
    rows = rows.where("conversation_id", "=", filter.conversation);
  const totals = {
    model: sql<string>`coalesce(sum(model_usd),0)`,
    search: sql<string>`coalesce(sum(search_usd),0)`,
    sandbox: sql<string>`coalesce(sum(sandbox_usd),0)`,
    total: sql<string>`coalesce(sum(cost_usd),0)`,
  };
  const users = await rows
    .select([
      "owner_id",
      sql<string>`count(*) filter (where kind='session')`.as("sessions"),
      sql<string>`count(*) filter (where kind='warm')`.as("unused_warm"),
      sql<string>`count(distinct conversation_id)`.as("conversations"),
      totals.model.as("model"),
      totals.search.as("search"),
      totals.sandbox.as("sandbox"),
      totals.total.as("total"),
      sql<Date>`max(updated_at)`.as("last"),
    ])
    .groupBy("owner_id")
    .orderBy("total", "desc")
    .execute();
  const conversations = await rows
    .select([
      "owner_id",
      "conversation_id",
      sql<string>`count(*)`.as("sessions"),
      sql<string>`coalesce(sum(input_tokens),0)`.as("input"),
      sql<string>`coalesce(sum(output_tokens),0)`.as("output"),
      sql<string>`coalesce(sum(web_searches),0)`.as("searches"),
      totals.total.as("total"),
    ])
    .where("kind", "=", "session")
    .groupBy(["owner_id", "conversation_id"])
    .orderBy("total", "desc")
    .limit(50)
    .execute();
  const sessions = await rows
    .select([
      "id",
      "conversation_id",
      "model",
      "service_tier",
      "input_tokens",
      "cached_tokens",
      "output_tokens",
      "web_searches",
      "sandbox_size",
      sql<string>`round(extract(epoch from sandbox_last_at - sandbox_started_at)/60, 1)`.as(
        "sandbox_minutes",
      ),
      "model_usd",
      "search_usd",
      "sandbox_usd",
      "cost_usd",
      "usage_pending",
    ])
    .where("kind", "=", "session")
    .orderBy("updated_at", "desc")
    .limit(filter.conversation || filter.user ? 100 : 25)
    .execute();
  return {
    limitUsd: spendLimitUsd(),
    users: users.map((u) => ({
      user: u.owner_id,
      conversations: Number(u.conversations),
      sessions: Number(u.sessions),
      unusedWarmSandboxes: Number(u.unused_warm),
      modelUsd: usd(u.model),
      searchUsd: usd(u.search),
      sandboxUsd: usd(u.sandbox),
      totalUsd: usd(u.total),
      allowanceUsed: `${Math.round((Number(u.total) / spendLimitUsd()) * 100)}%`,
      lastActivity: new Date(u.last).toISOString(),
    })),
    conversations: conversations.map((c) => ({
      user: c.owner_id,
      conversation: c.conversation_id,
      sessions: Number(c.sessions),
      inputTokens: Number(c.input),
      outputTokens: Number(c.output),
      searches: Number(c.searches),
      totalUsd: usd(c.total),
    })),
    sessions: sessions.map((s) => ({
      session: s.id,
      conversation: s.conversation_id,
      model: s.model,
      tier: s.service_tier,
      input: Number(s.input_tokens),
      cached: Number(s.cached_tokens),
      output: Number(s.output_tokens),
      searches: s.web_searches,
      sandbox: `${s.sandbox_size} ${s.sandbox_minutes} min`,
      modelUsd: usd(s.model_usd),
      searchUsd: usd(s.search_usd),
      sandboxUsd: usd(s.sandbox_usd),
      totalUsd: usd(s.cost_usd),
      pending: s.usage_pending,
    })),
  };
}
