import { auth } from "@clerk/nextjs/server";
import { AppError } from "./errors";
import { configured, required } from "./config";
import { db } from "./db";
export function verifyOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(required("APP_ORIGIN")).origin)
    throw new AppError(403, "Request origin is not allowed.");
}
/**
 * Access follows Clerk: sign-up is invite-only, so every signed-in account may
 * use Agent 21 and gets its row on first use. `pnpm beta revoke` bans the
 * account in Clerk, so it cannot sign in even after its row is deleted with its
 * data; an account being deleted has no access until the deletion finishes.
 */
export async function hasAccess(userId: string) {
  const find = () =>
    db()
      .selectFrom("agent21_users")
      .select(["beta_enabled", "deleting"])
      .where("id", "=", userId)
      .executeTakeFirst();
  let user = await find();
  if (!user) {
    await db()
      .insertInto("agent21_users")
      .values({ id: userId, beta_enabled: true })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    user = await find();
  }
  return Boolean(user?.beta_enabled && !user.deleting);
}
export async function identity(request?: Request, lifecycle = false) {
  if (!configured())
    throw new AppError(503, "The Agent 21 beta is not available yet.");
  if (request && !["GET", "HEAD"].includes(request.method))
    verifyOrigin(request);
  const { userId } = await auth();
  if (!userId) throw new AppError(401, "Please sign in.");
  if (lifecycle) return userId;
  if (!(await hasAccess(userId)))
    throw new AppError(403, "This account does not have access to Agent 21.");
  return userId;
}
