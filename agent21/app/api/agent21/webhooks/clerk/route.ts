import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { start } from "workflow/api";
import { db } from "@/lib/agent21/db";
import { requestDeletion } from "@/lib/agent21/deletion";
import { handler } from "@/lib/agent21/http";
import { agent21Deletion } from "@/workflows/agent21";

/** A Clerk account deletion removes the user's Agent 21 data as well. */
export const POST = handler(async (request) => {
  const event = await verifyWebhook(request as NextRequest);
  if (event.type === "user.deleted" && event.data.id) {
    const user = await db()
      .selectFrom("agent21_users")
      .select("id")
      .where("id", "=", event.data.id)
      .executeTakeFirst();
    if (user) {
      const id = await requestDeletion(user.id);
      const job = await start(agent21Deletion, [id]);
      await db()
        .updateTable("agent21_deletions")
        .set({ workflow_id: job.runId })
        .where("id", "=", id)
        .execute();
    }
  }
  return Response.json({ ok: true });
});
