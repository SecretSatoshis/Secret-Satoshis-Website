import { readFile, readdir } from "node:fs/promises";
import { sql, type Kysely } from "kysely";
import {
  Migrator,
  type Migration,
  type MigrationProvider,
} from "kysely/migration";

const directory = new URL("../../migrations/", import.meta.url);
/** The numbered SQL files are the schema history; Kysely records which have run. */
const sqlFiles: MigrationProvider = {
  async getMigrations() {
    const files = (await readdir(directory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    return Object.fromEntries(
      await Promise.all(
        files.map(async (file) => {
          const text = await readFile(new URL(file, directory), "utf8");
          const migration: Migration = {
            up: async (db) => {
              await sql.raw(text).execute(db);
            },
          };
          return [file.replace(/\.sql$/, ""), migration] as const;
        }),
      ),
    );
  },
};
// Migrations run before the typed schema exists, so they take an untyped database.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrator(db: Kysely<any>) {
  return new Migrator({
    db,
    provider: sqlFiles,
    migrationTableName: "agent21_migrations",
    migrationLockTableName: "agent21_migration_lock",
  });
}
/** Applies pending migrations in order, each in its own transaction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function migrateToLatest(db: Kysely<any>) {
  const { error, results } = await migrator(db).migrateToLatest();
  if (error) throw error;
  return (results ?? [])
    .filter((result) => result.status === "Success")
    .map((result) => result.migrationName);
}
