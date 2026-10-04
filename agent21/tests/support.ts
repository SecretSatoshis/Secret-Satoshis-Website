import OpenAI from "openai";
import { PGlite } from "@electric-sql/pglite";
import type { PostgresPool } from "kysely";
import { db, setDatabaseForTests } from "../lib/agent21/db";
import { migrateToLatest } from "../lib/agent21/migrations";
import { setOpenAIForTests } from "../lib/agent21/openai";

/**
 * An embedded Postgres behind the app's own query layer and migrations.
 * PGlite has one session, so concurrent transactions are not exercised here;
 * real Neon concurrency still needs preview integration tests.
 */
export async function testDatabase() {
  Object.assign(process.env, { NODE_ENV: "test" });
  const pg = new PGlite();
  // Parameterless statements (migrations, BEGIN/COMMIT) may hold several
  // commands, which only the simple query protocol accepts.
  const query = async (text: string, values: unknown[] = []) => {
    const result = values.length
      ? await pg.query(text, values)
      : (await pg.exec(text)).at(-1);
    return { rows: result?.rows ?? [], rowCount: result?.affectedRows ?? 0 };
  };
  const client = { query, release() {} };
  setDatabaseForTests({
    connect: async () => client,
    end: async () => {},
  } as unknown as PostgresPool);
  await migrateToLatest(db());
  return {
    /** Raw SQL for test setup and assertions. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sql: async (text: string, values: unknown[] = []): Promise<any[]> =>
      (await pg.query(text, values)).rows,
    close: () => pg.close(),
  };
}
/** The app's OpenAI client bound to a fake provider, without SDK retries. */
export function fakeOpenAI(fetch: typeof globalThis.fetch) {
  process.env.OPENAI_API_KEY = "test-key";
  setOpenAIForTests(new OpenAI({ apiKey: "test-key", maxRetries: 0, fetch }));
}
