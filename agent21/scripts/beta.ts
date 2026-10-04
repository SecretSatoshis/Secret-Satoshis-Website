import { clerkClient } from "@clerk/nextjs/server";
import { sql } from "kysely";
import { closeDatabase, db } from "../lib/agent21/db";
import { LIMITS, setting } from "../lib/agent21/config";
import { logDiagnostic } from "../lib/agent21/diagnostics";
const [action, user] = process.argv.slice(2);
try {
  if (
    !["grant", "revoke"].includes(action) ||
    !/^user_[A-Za-z0-9]+$/.test(user ?? "")
  )
    throw new Error("Usage: pnpm beta grant|revoke <Clerk user ID>");
  if (action === "grant") {
    const account = await (await clerkClient()).users.getUser(user);
    const email = account.emailAddresses.find(
      (e) => e.id === account.primaryEmailAddressId,
    );
    if (email?.verification?.status !== "verified")
      throw new Error(
        "Verify the invited primary email before granting beta access.",
      );
  }
  await db()
    .transaction()
    .execute(async (trx) => {
      if (action === "grant") {
        // Serializes concurrent grants so the capacity check holds.
        await sql`LOCK TABLE agent21_users IN SHARE ROW EXCLUSIVE MODE`.execute(
          trx,
        );
        const { count } = await trx
          .selectFrom("agent21_users")
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .where("beta_enabled", "=", true)
          .where("deleting", "=", false)
          .where("id", "<>", user)
          .executeTakeFirstOrThrow();
        if (Number(count) >= setting("AGENT21_MAX_USERS", LIMITS.users))
          throw new Error("Beta capacity reached");
        await trx
          .insertInto("agent21_users")
          .values({ id: user, beta_enabled: true })
          .onConflict((oc) =>
            oc
              .column("id")
              .doUpdateSet({ beta_enabled: true })
              .where("agent21_users.deleting", "=", false),
          )
          .execute();
      } else
        await trx
          .updateTable("agent21_users")
          .set({ beta_enabled: false })
          .where("id", "=", user)
          .execute();
    });
  console.log(`Beta access ${action === "grant" ? "granted" : "revoked"}.`);
} catch (error) {
  logDiagnostic(error, "beta_failed");
  console.error(
    "Beta access operation failed. Check grant|revoke, the Clerk user ID, verified primary email, available capacity and private configuration.",
  );
  process.exitCode = 1;
} finally {
  if (process.env.DATABASE_URL)
    await closeDatabase().catch((error) => {
      logDiagnostic(error, "beta_failed", { provider: "neon" });
      process.exitCode = 1;
    });
}
