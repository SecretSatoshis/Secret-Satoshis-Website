import { identity } from "@/lib/agent21/auth";
import { db, ownedRun } from "@/lib/agent21/db";
import { handler } from "@/lib/agent21/http";
import { openai } from "@/lib/agent21/openai";
import { idSchema, scheduleRun } from "@/lib/agent21/service";

export const POST = handler<{ id: string }>(async (request, { id }) => {
  const run = await ownedRun(await identity(request), idSchema.parse(id));
  // The session is shared by the conversation's runs: a stale Stop for a
  // finished run must not cancel whatever turn is running now.
  if (run.finished_at) return Response.json({ ok: true });
  await db()
    .updateTable("agent21_runs")
    .set({ cancel_requested: true })
    .where("id", "=", run.id)
    .execute();
  if (run.provider_accepted && run.session_id)
    await openai().beta.agents.sessions.events.create(run.session_id, {
      events: [{ type: "agent.session.input.cancel" }],
    });
  // A run whose start failed has no workflow to see the request; start one so
  // the run settles as stopped.
  await scheduleRun(run);
  return Response.json({ ok: true });
});
