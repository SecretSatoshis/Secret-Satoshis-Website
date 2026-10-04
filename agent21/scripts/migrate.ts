import { closeDatabase, db } from "../lib/agent21/db";
import { migrateToLatest } from "../lib/agent21/migrations";
import { logDiagnostic } from "../lib/agent21/diagnostics";
try {
  const applied = await migrateToLatest(db());
  console.log(
    applied.length
      ? `Applied Agent 21 migrations: ${applied.join(", ")}.`
      : "Agent 21 database is up to date.",
  );
} catch (error) {
  logDiagnostic(error, "migration_failed", { provider: "neon" });
  console.error(
    "Database migration failed. Inspect configuration and migration compatibility privately.",
  );
  process.exitCode = 1;
} finally {
  await closeDatabase().catch((error) => {
    logDiagnostic(error, "migration_failed", { provider: "neon" });
    process.exitCode = 1;
  });
}
