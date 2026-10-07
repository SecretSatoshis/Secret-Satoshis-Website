// Access follows Clerk's invite-only sign-up: every invited account gets in on
// its first visit. revoke pauses one account, and grant restores it.
import { clerkClient } from "@clerk/nextjs/server";
import { closeDatabase, db } from "../lib/agent21/db";
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
  if (action === "grant")
    await db()
      .insertInto("agent21_users")
      .values({ id: user, beta_enabled: true })
      .onConflict((oc) =>
        oc
          .column("id")
          .doUpdateSet({ beta_enabled: true })
          .where("agent21_users.deleting", "=", false),
      )
      .execute();
  else
    await db()
      .updateTable("agent21_users")
      .set({ beta_enabled: false })
      .where("id", "=", user)
      .execute();
  console.log(`Beta access ${action === "grant" ? "granted" : "revoked"}.`);
} catch (error) {
  logDiagnostic(error, "beta_failed");
  console.error(
    "Beta access operation failed. Check grant|revoke, the Clerk user ID, verified primary email and private configuration.",
  );
  process.exitCode = 1;
} finally {
  if (process.env.DATABASE_URL)
    await closeDatabase().catch((error) => {
      logDiagnostic(error, "beta_failed", { provider: "neon" });
      process.exitCode = 1;
    });
}
