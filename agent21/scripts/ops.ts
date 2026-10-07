import { sql } from "kysely";
import { closeDatabase, db } from "../lib/agent21/db";
import { migrator } from "../lib/agent21/migrations";
import {
  credentialNames,
  isLoopbackDevelopment,
  LIMITS,
  missingCredentials,
} from "../lib/agent21/config";
import { logDiagnostic, storedDiagnostic } from "../lib/agent21/diagnostics";

const args = process.argv.slice(2);
const json = args.includes("--json");

function configuration() {
  const present = (name: string) => Boolean(process.env[name]);
  const group = (names: string[]) => ({
    configuration: names.every(present) ? "configured" : "incomplete",
    connectivity: "not_checked",
  });
  const release = process.env.AGENT21_RUNTIME_VERSION ?? "";
  return {
    mode: isLoopbackDevelopment() ? "loopback_development" : "deployment",
    environment: ["development", "production", "test"].includes(
      process.env.NODE_ENV ?? "",
    )
      ? process.env.NODE_ENV
      : "unspecified",
    credentials: Object.fromEntries(
      [
        ...credentialNames,
        "BLOB_STORE_ID",
        "BLOB_READ_WRITE_TOKEN",
        "CRON_SECRET",
      ].map((name) => [name, present(name) ? "present" : "missing"]),
    ),
    runtimeRelease: /^a21-[a-f0-9]{20}$/.test(release)
      ? release
      : "missing_or_invalid",
    agentEnabledFlag: process.env.AGENT21_ENABLED === "true",
    // Settings the app needs before it serves anyone; empty when complete.
    missingConfiguration: missingCredentials(),
    providers: {
      clerk: group(["CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]),
      openai: group([
        "OPENAI_API_KEY",
        "AGENT21_AGENT_ID",
        "AGENT21_ENVIRONMENT_TEMPLATE_ID",
      ]),
      neon: group(["DATABASE_URL"]),
      blob: {
        configuration: present("BLOB_STORE_ID")
          ? "oidc"
          : present("BLOB_READ_WRITE_TOKEN")
            ? "read_write_token"
            : "incomplete",
        connectivity: "not_checked",
      },
      workflow: {
        configuration: "included_in_application",
        connectivity: "not_checked",
      },
      errorReports: present("SENTRY_DSN") ? "sentry" : "logs_only",
    },
    limits: {
      activePerUser: 1,
      deadlineSeconds: LIMITS.turnMs / 1000,
      hardStopSeconds: LIMITS.abandonMs / 1000,
      uploadBytes: LIMITS.uploadBytes,
      generatedFileBytes: LIMITS.outputBytes,
      storagePerUserBytes: LIMITS.storageBytes,
      attachmentsPerConversation: LIMITS.attachments,
    },
  };
}

/** Real charges from the OpenAI Costs API for the current UTC month. */
async function providerCosts() {
  const key = process.env.OPENAI_ADMIN_KEY;
  if (!key) return { status: "not_configured" as const };
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000;
  const days = new Map<string, Record<string, number>>();
  let page: string | undefined;
  do {
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.searchParams.set("start_time", String(start));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", "31");
    url.searchParams.append("group_by", "line_item");
    if (process.env.OPENAI_PROJECT_ID)
      url.searchParams.append("project_ids", process.env.OPENAI_PROJECT_ID);
    if (page) url.searchParams.set("page", page);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok)
      return { status: "unavailable" as const, httpStatus: response.status };
    const body = (await response.json()) as {
      data: {
        start_time: number;
        results: { amount: { value: number }; line_item: string | null }[];
      }[];
      has_more: boolean;
      next_page: string | null;
    };
    for (const bucket of body.data) {
      const day = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
      const items = days.get(day) ?? {};
      for (const result of bucket.results)
        items[result.line_item ?? "other"] =
          (items[result.line_item ?? "other"] ?? 0) + result.amount.value;
      days.set(day, items);
    }
    page = body.has_more ? (body.next_page ?? undefined) : undefined;
  } while (page);
  const rows = [...days].map(([day, items]) => ({
    day,
    usd: Object.values(items).reduce((sum, value) => sum + value, 0),
    ...items,
  }));
  return {
    status: "available" as const,
    scope: process.env.OPENAI_PROJECT_ID ? "project" : "organization",
    monthUsd: rows.reduce((sum, row) => sum + row.usd, 0),
    days: rows.filter((row) => row.usd > 0),
  };
}

async function snapshot() {
  if (!process.env.DATABASE_URL) return { status: "not_configured" as const };
  const migrations = await migrator(db()).getMigrations();
  const pending = migrations
    .filter((migration) => !migration.executedAt)
    .map((migration) => migration.name);
  if (pending.length)
    return { status: "schema_needs_migration" as const, pending };
  return db()
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (trx) => {
      await sql`SET LOCAL statement_timeout='15s'`.execute(trx);
      await sql`SET LOCAL lock_timeout='3s'`.execute(trx);
      const rows = async (query: ReturnType<typeof sql>) =>
        (await query.execute(trx)).rows as Record<string, unknown>[];
      const [users] = await rows(sql`SELECT count(*)::int AS total,
        count(*) FILTER(WHERE beta_enabled AND NOT deleting)::int AS beta_enabled,
        count(*) FILTER(WHERE deleting)::int AS deleting FROM agent21_users`);
      const [conversations] = await rows(
        sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE deleting)::int AS deleting FROM agent21_conversations`,
      );
      const releases = await rows(
        sql`SELECT runtime_version,count(*)::int AS conversations FROM agent21_conversations GROUP BY runtime_version ORDER BY count(*) DESC`,
      );
      const states = await rows(
        sql`SELECT state,count(*)::int AS count FROM agent21_runs GROUP BY state ORDER BY state`,
      );
      const [work] =
        await rows(sql`SELECT count(*) FILTER(WHERE finished_at IS NULL)::int AS active,
        count(*) FILTER(WHERE state='unknown')::int AS uncertain,
        count(*) FILTER(WHERE finished_at IS NULL AND created_at<now()-interval '10 minutes')::int AS unfinished_over_deadline,
        count(*) FILTER(WHERE worker_lease_until>now())::int AS leased,
        count(*) FILTER(WHERE created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::int AS started_today
        FROM agent21_runs`);
      const [latency] = await rows(sql`SELECT count(*)::int AS finished_runs,
        avg(extract(epoch FROM finished_at-created_at))::float AS mean_seconds,
        percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM finished_at-created_at))::float AS median_seconds,
        percentile_cont(0.95) WITHIN GROUP(ORDER BY extract(epoch FROM finished_at-created_at))::float AS p95_seconds
        FROM agent21_runs WHERE finished_at>=now()-interval '30 days'`);
      const recent =
        await rows(sql`SELECT id,state,created_at,finished_at,last_error_at,last_diagnostic
        FROM agent21_runs ORDER BY created_at DESC LIMIT 10`);
      const storage = await rows(
        sql`SELECT kind,state,count(*)::int AS files,COALESCE(sum(bytes),0)::float AS bytes FROM agent21_files GROUP BY kind,state ORDER BY kind,state`,
      );
      const [storageTotals] =
        await rows(sql`SELECT count(*)::int AS files,COALESCE(sum(bytes),0)::float AS bytes,
        count(*) FILTER(WHERE state='pending' AND created_at<now()-interval '30 minutes')::int AS pending_over_30_minutes FROM agent21_files`);
      const deletions = await rows(
        sql`SELECT state,count(*)::int AS jobs,min(created_at) AS oldest_created_at FROM agent21_deletions GROUP BY state ORDER BY state`,
      );
      const fileDeletions = await rows(
        sql`SELECT state,count(*)::int AS jobs,min(created_at) AS oldest_created_at FROM agent21_file_deletions GROUP BY state ORDER BY state`,
      );
      return {
        status: "snapshot_available" as const,
        migrations: migrations.length,
        users,
        conversations,
        releases: releases.map((r) => ({
          ...r,
          runtime_version: /^a21-[a-f0-9]{20}$/.test(String(r.runtime_version))
            ? r.runtime_version
            : "unrecognized",
        })),
        runs: {
          states,
          work,
          latencyLast30Days: latency,
          recent: recent.map((r) => ({
            ...r,
            last_diagnostic: storedDiagnostic(r.last_diagnostic),
          })),
        },
        storage: { totals: storageTotals, breakdown: storage },
        cleanup: { conversationsAndAccounts: deletions, files: fileDeletions },
      };
    });
}

async function reportData() {
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    configuration: configuration(),
    database: await snapshot(),
    providerCosts: await providerCosts(),
    coverage: [
      "Read-only application snapshot; no agent runs, provider probes or mutations.",
      "No prompts, responses, tool arguments/results, file names, owner IDs or credential values are included.",
      "Latency includes queue and persistence time. Run history excludes deleted records.",
      "Storage counts use database metadata, not a Blob inventory or invoice.",
      "Provider costs come from the OpenAI Costs API and lag by up to a day; organization scope includes other projects.",
    ],
  };
}
function display(report: Awaited<ReturnType<typeof reportData>>) {
  console.log(`Agent 21 operations — ${report.generatedAt}`);
  console.log(
    `Mode: ${report.configuration.mode}; runtime: ${report.configuration.runtimeRelease}`,
  );
  console.log(`Flags: agent=${report.configuration.agentEnabledFlag}`);
  const missing = report.configuration.missingConfiguration;
  console.log(
    missing.length
      ? `Missing configuration: ${missing.join(", ")}`
      : "Configuration complete (connectivity not checked).",
  );
  console.log("Configuration presence (connectivity was not checked):");
  console.table(report.configuration.credentials);
  console.log("Limits:");
  console.table(report.configuration.limits);
  const db = report.database;
  console.log(`Database: ${db.status}`);
  if (db.status === "schema_needs_migration")
    console.log("Apply migrations:", db.pending);
  if (db.status === "snapshot_available") {
    console.log(`Migrations applied: ${db.migrations}`);
    console.log("Users and conversations:", db.users, db.conversations);
    console.log("Conversation releases:");
    console.table(db.releases);
    console.log("Run states:");
    console.table(db.runs.states);
    console.log("Active work:", db.runs.work);
    console.log("End-to-end latency, last 30 days:", db.runs.latencyLast30Days);
    console.log("Recent runs and safe diagnostics:");
    console.dir(db.runs.recent, { depth: 4 });
    console.log("Storage metadata:", db.storage.totals);
    console.table(db.storage.breakdown);
    console.log("Cleanup:");
    console.dir(db.cleanup, { depth: 3 });
  }
  const costs = report.providerCosts;
  if (costs.status === "available") {
    console.log(
      `OpenAI costs this UTC month (${costs.scope}): $${costs.monthUsd.toFixed(2)}`,
    );
    console.table(costs.days);
  } else
    console.log(
      costs.status === "not_configured"
        ? "OpenAI costs: set OPENAI_ADMIN_KEY (and OPENAI_PROJECT_ID) to include them."
        : `OpenAI costs unavailable (HTTP ${costs.httpStatus}).`,
    );
  report.coverage.forEach((line) => console.log(line));
}
try {
  if (args[0] !== "report" || args.some((a, i) => i > 0 && a !== "--json")) {
    console.error(
      "Use ops report [--json]. Load the private environment first.",
    );
    process.exitCode = 1;
  } else {
    const report = await reportData();
    if (json) console.log(JSON.stringify(report, null, 2));
    else display(report);
    if (report.database.status !== "snapshot_available") process.exitCode = 1;
  }
} catch (error) {
  const diagnostic = logDiagnostic(error, "ops_report_failed");
  if (json)
    console.log(
      JSON.stringify({ schemaVersion: 2, status: "report_failed", diagnostic }),
    );
  else
    console.error(
      "Operations report failed. Check private database configuration and migrations using the diagnostic reference.",
    );
  process.exitCode = 1;
} finally {
  if (process.env.DATABASE_URL)
    await closeDatabase().catch((error) => {
      logDiagnostic(error, "ops_report_failed", { provider: "neon" });
      process.exitCode = 1;
    });
}
