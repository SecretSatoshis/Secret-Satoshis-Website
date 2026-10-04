import { resumeHook } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";
import { z } from "zod";
import { required } from "@/lib/agent21/config";
import { db } from "@/lib/agent21/db";
import { AppError } from "@/lib/agent21/errors";
import { handler } from "@/lib/agent21/http";
import { openai } from "@/lib/agent21/openai";
import { runHookToken } from "@/lib/agent21/runner";

const eventSchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  data: z.object({ id: z.string() }),
});
/**
 * Session lifecycle events wake the workflow driving each unfinished run on
 * that session, so tool calls and finished answers are handled immediately.
 */
export const POST = handler(async (request) => {
  const raw = await request.text();
  try {
    await openai().webhooks.verifySignature(
      raw,
      request.headers,
      required("OPENAI_WEBHOOK_SECRET"),
    );
  } catch {
    throw new AppError(400, "Invalid webhook signature.");
  }
  const event = eventSchema.parse(JSON.parse(raw));
  const eventId = event.id || request.headers.get("webhook-id");
  if (!eventId) throw new AppError(400, "Webhook identifier missing.");
  const seen = await db()
    .selectFrom("agent21_events")
    .select("id")
    .where("id", "=", eventId)
    .executeTakeFirst();
  if (seen) return Response.json({ ok: true });
  const runs = await db()
    .selectFrom("agent21_runs")
    .select("id")
    .where("session_id", "=", event.data.id)
    .where("finished_at", "is", null)
    .execute();
  for (const run of runs)
    await resumeHook(runHookToken(run.id), { type: event.type }).catch(
      (error) => {
        // The run's workflow has ended or not started yet; its timer covers it.
        if (!HookNotFoundError.is(error)) throw error;
      },
    );
  // Recorded only after delivery, so a failed delivery is retried by OpenAI.
  await db()
    .insertInto("agent21_events")
    .values({ id: eventId })
    .onConflict((oc) => oc.doNothing())
    .execute();
  return Response.json({ ok: true });
});
