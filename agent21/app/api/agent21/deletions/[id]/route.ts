import { identity } from "@/lib/agent21/auth";
import { db } from "@/lib/agent21/db";
import { AppError } from "@/lib/agent21/errors";
import { handler } from "@/lib/agent21/http";
import { idSchema } from "@/lib/agent21/service";

// Deletion receipts stay readable after beta access ends.
export const GET = handler<{ id: string }>(async (request, { id }) => {
  const owner = await identity(request, true);
  const deletion = idSchema.parse(id);
  const job = await db()
    .selectFrom("agent21_deletions")
    .select("state")
    .where("id", "=", deletion)
    .where("owner_id", "=", owner)
    .unionAll(
      db()
        .selectFrom("agent21_file_deletions")
        .select("state")
        .where("id", "=", deletion)
        .where("owner_id", "=", owner),
    )
    .executeTakeFirst();
  if (!job) throw new AppError(404, "Deletion not found.");
  return Response.json(job);
});
