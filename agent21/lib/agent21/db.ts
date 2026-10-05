import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import { required } from "./config";
import type { Database, RunInput } from "./schema";

type PoolLike = ConstructorParameters<typeof PostgresDialect>[0]["pool"];
let instance: Kysely<Database> | undefined;
// pg 8 already verifies certificates for sslmode=require; naming verify-full
// keeps that behaviour explicit when pg 9 relaxes require to libpq semantics.
const connectionString = () =>
  required("DATABASE_URL").replace(
    /([?&])sslmode=require(?=&|$)/,
    "$1sslmode=verify-full",
  );
/** One pool per instance; Fluid compute closes idle clients before suspending. */
export function db() {
  if (!instance) {
    const pool = new pg.Pool({ connectionString: connectionString(), max: 5 });
    attachDatabasePool(pool);
    instance = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  }
  return instance;
}
export async function closeDatabase() {
  await instance?.destroy();
  instance = undefined;
}
/** Test-only injection exercises the same queries against an embedded Postgres engine. */
export function setDatabaseForTests(pool: PoolLike) {
  if (process.env.NODE_ENV !== "test")
    throw new Error("Test adapter is disabled");
  instance = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
/**
 * Serializes one user's state changes: starting an answer, reserving file
 * storage and requesting deletions. Other users never wait on this lock.
 */
export function userTransaction<T>(
  owner: string,
  fn: (trx: Transaction<Database>) => Promise<T>,
) {
  return db()
    .transaction()
    .execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${owner}))`.execute(trx);
      return fn(trx);
    });
}
export const isUniqueViolation = (error: unknown, constraint?: string) =>
  error instanceof Error &&
  "code" in error &&
  error.code === "23505" &&
  (!constraint || ("constraint" in error && error.constraint === constraint));

export async function ownedConversation(owner: string, id: string) {
  const row = await db()
    .selectFrom("agent21_conversations")
    .selectAll()
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .where("deleting", "=", false)
    .executeTakeFirst();
  if (!row) throw new AppError(404, "Conversation not found.");
  return row;
}
export async function ownedRun(owner: string, id: string) {
  const row = await db()
    .selectFrom("agent21_runs as r")
    .innerJoin("agent21_conversations as c", "c.id", "r.conversation_id")
    .selectAll("r")
    .where("r.id", "=", id)
    .where("r.owner_id", "=", owner)
    .where("c.deleting", "=", false)
    .executeTakeFirst();
  if (!row) throw new AppError(404, "Run not found.");
  return row;
}
const busy = () =>
  new AppError(409, "Please wait for your current response to finish.");
/**
 * Starts an answer. The beta has no message or spending caps; each user runs one
 * answer at a time, enforced by the agent21_runs_one_active unique index.
 */
export async function reserveRun(
  owner: string,
  conversation: string,
  request: string,
  input: RunInput,
) {
  const existing = () =>
    db()
      .selectFrom("agent21_runs")
      .selectAll()
      .where("conversation_id", "=", conversation)
      .where("request_id", "=", request)
      .where("owner_id", "=", owner)
      .executeTakeFirst();
  try {
    return await userTransaction(owner, async (trx) => {
      const retried = await trx
        .selectFrom("agent21_runs")
        .selectAll()
        .where("conversation_id", "=", conversation)
        .where("request_id", "=", request)
        .where("owner_id", "=", owner)
        .executeTakeFirst();
      if (retried) return retried;
      const allowed = await trx
        .selectFrom("agent21_conversations as c")
        .innerJoin("agent21_users as u", "u.id", "c.owner_id")
        .select("c.id")
        .where("c.id", "=", conversation)
        .where("c.owner_id", "=", owner)
        .where("c.deleting", "=", false)
        .where("u.beta_enabled", "=", true)
        .where("u.deleting", "=", false)
        .executeTakeFirst();
      if (!allowed) throw new AppError(404, "Conversation not found.");
      const cleanup = await trx
        .selectFrom("agent21_file_deletions")
        .select("id")
        .where("conversation_id", "=", conversation)
        .where("state", "=", "pending")
        .executeTakeFirst();
      if (cleanup)
        throw new AppError(
          409,
          "File deletion is in progress. Please wait for cleanup before sending another message.",
        );
      return trx
        .insertInto("agent21_runs")
        .values({
          id: randomUUID(),
          conversation_id: conversation,
          owner_id: owner,
          request_id: request,
          input: JSON.stringify(input),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // A concurrent retry of this request won the insert; anything else is a
    // second answer while one is still running.
    const run = await existing();
    if (run) return run;
    throw busy();
  }
}
/** Records a run's outcome once; later calls leave the first settlement in place. */
export async function settle(
  runId: string,
  state: "completed" | "failed" | "cancelled",
) {
  await db()
    .updateTable("agent21_runs")
    .set({
      state,
      finished_at: sql<Date>`now()`,
      input: null,
      submission: null,
    })
    .where("id", "=", runId)
    .where("finished_at", "is", null)
    .execute();
}
