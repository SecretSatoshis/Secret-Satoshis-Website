import { sql } from "kysely";
import { getRun, start } from "workflow/api";
import { db } from "@/lib/agent21/db";
import { LIMITS } from "@/lib/agent21/config";
import { AppError } from "@/lib/agent21/errors";
import { removeFile } from "@/lib/agent21/files";
import { handler } from "@/lib/agent21/http";
import {
  agent21Deletion,
  agent21FileDeletion,
  agent21Run,
} from "@/workflows/agent21";

// A job is restarted only when its last workflow has stopped.
async function workflowActive(workflow: string | null) {
  if (!workflow || workflow === "scheduling") return false;
  const status = await getRun(workflow).status;
  return status === "running" || status === "pending";
}
const minutesAgo = (minutes: number) =>
  sql<Date>`now() - make_interval(mins => ${minutes})`;
/**
 * Recovery for work whose workflow stopped: unfinished answers, deletions and
 * abandoned uploads. Meant for Vercel Cron, which sends CRON_SECRET; nothing
 * schedules it yet, and without CRON_SECRET it refuses every call.
 */
export const GET = handler(async (request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    throw new AppError(401, "Unauthorized.");
  for (const run of await db()
    .selectFrom("agent21_runs")
    .select(["id", "workflow_id"])
    .where("finished_at", "is", null)
    .where("created_at", "<", minutesAgo(3))
    .where((eb) =>
      eb.or([
        eb("worker_lease_until", "is", null),
        eb("worker_lease_until", "<", sql<Date>`now()`),
      ]),
    )
    .limit(10)
    .execute()) {
    if (await workflowActive(run.workflow_id)) continue;
    const job = await start(agent21Run, [run.id]);
    await db()
      .updateTable("agent21_runs")
      .set({ workflow_id: job.runId })
      .where("id", "=", run.id)
      .execute();
  }
  for (const table of ["agent21_deletions", "agent21_file_deletions"] as const)
    for (const deletion of await db()
      .selectFrom(table)
      .select(["id", "workflow_id"])
      .where("state", "=", "pending")
      .where("created_at", "<", minutesAgo(2))
      .limit(10)
      .execute()) {
      if (await workflowActive(deletion.workflow_id)) continue;
      const job = await start(
        table === "agent21_deletions" ? agent21Deletion : agent21FileDeletion,
        [deletion.id],
      );
      await db()
        .updateTable(table)
        .set({ workflow_id: job.runId })
        .where("id", "=", deletion.id)
        .execute();
    }
  for (const file of await db()
    .selectFrom("agent21_files")
    .selectAll()
    .where("kind", "=", "upload")
    .where("state", "=", "pending")
    .where("created_at", "<", minutesAgo(LIMITS.pendingFileMs / 60_000))
    .limit(20)
    .execute())
    await removeFile(file);
  await db()
    .deleteFrom("agent21_events")
    .where("created_at", "<", minutesAgo(30 * 24 * 60))
    .execute();
  return Response.json({ ok: true });
});
