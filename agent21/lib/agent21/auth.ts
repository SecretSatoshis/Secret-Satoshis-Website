import { auth } from "@clerk/nextjs/server";
import { AppError } from "./errors";
import { configured, required } from "./config";
import { db } from "./db";
export function verifyOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(required("APP_ORIGIN")).origin)
    throw new AppError(403, "Request origin is not allowed.");
}
export async function identity(request?: Request, lifecycle = false) {
  if (!configured())
    throw new AppError(503, "The Agent 21 beta is not available yet.");
  if (request && !["GET", "HEAD"].includes(request.method))
    verifyOrigin(request);
  const { userId } = await auth();
  if (!userId) throw new AppError(401, "Please sign in.");
  if (lifecycle) return userId;
  const user = await db()
    .selectFrom("agent21_users")
    .select("id")
    .where("id", "=", userId)
    .where("beta_enabled", "=", true)
    .where("deleting", "=", false)
    .executeTakeFirst();
  if (!user)
    throw new AppError(
      403,
      "Agent 21 is currently available to invited beta users.",
    );
  return userId;
}
