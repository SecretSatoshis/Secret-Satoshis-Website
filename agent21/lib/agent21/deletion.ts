import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { db, settle, userTransaction } from "./db";
import { isProviderError, openai } from "./openai";
import { removeFile } from "./files";
import { AppError } from "./errors";
export async function requestDeletion(owner: string, conversation?: string) {
  return userTransaction(owner, async (trx) => {
    const existing = await trx
      .selectFrom("agent21_deletions")
      .select("id")
      .where("owner_id", "=", owner)
      .where(
        sql<boolean>`conversation_id IS NOT DISTINCT FROM ${conversation ?? null}::uuid`,
      )
      .where("state", "<>", "completed")
      .executeTakeFirst();
    if (existing) return existing.id;
    if (conversation)
      await trx
        .updateTable("agent21_conversations")
        .set({ deleting: true })
        .where("owner_id", "=", owner)
        .where("id", "=", conversation)
        .execute();
    else {
      await trx
        .updateTable("agent21_users")
        .set({ deleting: true, beta_enabled: false })
        .where("id", "=", owner)
        .execute();
      await trx
        .updateTable("agent21_conversations")
        .set({ deleting: true })
        .where("owner_id", "=", owner)
        .execute();
    }
    let runs = trx
      .updateTable("agent21_runs")
      .set({ cancel_requested: true })
      .where("owner_id", "=", owner);
    if (conversation) runs = runs.where("conversation_id", "=", conversation);
    await runs.execute();
    const id = randomUUID();
    await trx
      .insertInto("agent21_deletions")
      .values({ id, owner_id: owner, conversation_id: conversation ?? null })
      .execute();
    return id;
  });
}
const ignoreMissing = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (error) {
    if (!isProviderError(error, 404)) throw error;
  }
};
/** Removes a conversation's sessions; deleting a session also clears its sandbox copies. */
async function removeSessions(conversation: string) {
  for (const session of await db()
    .selectFrom("agent21_sessions")
    .select("id")
    .where("conversation_id", "=", conversation)
    .execute()) {
    await ignoreMissing(() => openai().beta.agents.sessions.delete(session.id));
    await db()
      .deleteFrom("agent21_calls")
      .where("session_id", "=", session.id)
      .execute();
  }
  await db()
    .deleteFrom("agent21_sessions")
    .where("conversation_id", "=", conversation)
    .execute();
}
const leased = (conversation: string) =>
  db()
    .selectFrom("agent21_runs")
    .select("id")
    .where("conversation_id", "=", conversation)
    .where("worker_lease_until", ">", sql<Date>`now()`)
    .executeTakeFirst();
export async function performDeletion(id: string): Promise<boolean> {
  const job = await db()
    .selectFrom("agent21_deletions")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!job || job.state === "completed") return true;
  let conversations = db()
    .selectFrom("agent21_conversations")
    .select("id")
    .where("owner_id", "=", job.owner_id);
  if (job.conversation_id)
    conversations = conversations.where("id", "=", job.conversation_id);
  for (const conversation of await conversations.execute()) {
    const uploading = await db()
      .selectFrom("agent21_files")
      .select("id")
      .where("conversation_id", "=", conversation.id)
      .where("upload_token_expires_at", ">", sql<Date>`now()`)
      .executeTakeFirst();
    if (uploading || (await leased(conversation.id))) return false;
    const uncertainCreations = await db()
      .selectFrom("agent21_runs")
      .select("id")
      .where("conversation_id", "=", conversation.id)
      .where("finished_at", "is", null)
      .where("session_creation_started_at", "is not", null)
      .where("session_id", "is", null)
      .execute();
    if (uncertainCreations.length) {
      const { reconcileRun } = await import("./runner");
      // Failures are logged by the runner and retried on the next cleanup pass.
      for (const run of uncertainCreations)
        await reconcileRun(run.id).catch(() => undefined);
      return false;
    }
    for (const session of await db()
      .selectFrom("agent21_sessions")
      .select("id")
      .where("conversation_id", "=", conversation.id)
      .execute()) {
      let active = false;
      await ignoreMissing(async () => {
        const turns = await openai().beta.agents.sessions.turns.list(
          session.id,
          { limit: 10 },
        );
        active = turns.data.some((turn) =>
          ["queued", "in_progress", "waiting"].includes(turn.status),
        );
        if (active)
          await openai().beta.agents.sessions.events.create(session.id, {
            events: [{ type: "agent.session.input.cancel" }],
          });
      });
      if (active) return false;
    }
    for (const run of await db()
      .selectFrom("agent21_runs")
      .selectAll()
      .where("conversation_id", "=", conversation.id)
      .where("finished_at", "is", null)
      .execute())
      await settle(
        run.id,
        "cancelled",
        0,
        !run.provider_accepted &&
          !run.session_id &&
          !run.session_creation_started_at &&
          !run.submission,
      );
    await db()
      .deleteFrom("agent21_messages")
      .where("conversation_id", "=", conversation.id)
      .execute();
    for (const file of await db()
      .selectFrom("agent21_files")
      .selectAll()
      .where("conversation_id", "=", conversation.id)
      .execute())
      await removeFile(file);
    await removeSessions(conversation.id);
    await db()
      .deleteFrom("agent21_runs")
      .where("conversation_id", "=", conversation.id)
      .execute();
    await db()
      .deleteFrom("agent21_conversations")
      .where("id", "=", conversation.id)
      .execute();
  }
  if (!job.conversation_id)
    await db()
      .deleteFrom("agent21_users")
      .where("id", "=", job.owner_id)
      .execute();
  // Retain a non-content receipt so status checks can confirm completion after account deletion.
  await db()
    .updateTable("agent21_deletions")
    .set({ state: "completed" })
    .where("id", "=", id)
    .execute();
  return true;
}

export async function requestFileDeletion(owner: string, fileId: string) {
  return userTransaction(owner, async (trx) => {
    const file = await trx
      .selectFrom("agent21_files as f")
      .innerJoin("agent21_conversations as c", "c.id", "f.conversation_id")
      .select(["f.id", "f.conversation_id"])
      .where("f.id", "=", fileId)
      .where("f.owner_id", "=", owner)
      .where("c.deleting", "=", false)
      .executeTakeFirst();
    if (!file) throw new AppError(404, "File not found.");
    const active = await trx
      .selectFrom("agent21_runs")
      .select("id")
      .where("conversation_id", "=", file.conversation_id)
      .where("finished_at", "is", null)
      .executeTakeFirst();
    if (active)
      throw new AppError(
        409,
        "Please stop the response before deleting its files.",
      );
    const existing = await trx
      .selectFrom("agent21_file_deletions")
      .select("id")
      .where("file_id", "=", fileId)
      .executeTakeFirst();
    if (existing) return existing.id;
    const id = randomUUID();
    await trx
      .insertInto("agent21_file_deletions")
      .values({
        id,
        owner_id: owner,
        conversation_id: file.conversation_id,
        file_id: fileId,
      })
      .execute();
    await trx
      .updateTable("agent21_files")
      .set({ state: "deleting" })
      .where("id", "=", fileId)
      .execute();
    return id;
  });
}
export async function performFileDeletion(id: string): Promise<boolean> {
  const job = await db()
    .selectFrom("agent21_file_deletions")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!job || job.state === "completed") return true;
  const file = await db()
    .selectFrom("agent21_files")
    .selectAll()
    .where("id", "=", job.file_id)
    .where("owner_id", "=", job.owner_id)
    .executeTakeFirst();
  if (file) {
    if (
      file.upload_token_expires_at &&
      new Date(file.upload_token_expires_at).getTime() > Date.now()
    )
      return false;
    const conversation = await db()
      .selectFrom("agent21_conversations")
      .select("deleting")
      .where("id", "=", job.conversation_id)
      .executeTakeFirst();
    if (conversation?.deleting || (await leased(job.conversation_id)))
      return false;
    // New turns are blocked while this job is pending. Removing hosted sessions also
    // removes temporary copies of the deleted file; the next turn restores retained inputs.
    await removeSessions(job.conversation_id);
    await db()
      .updateTable("agent21_conversations")
      .set({ session_id: null })
      .where("id", "=", job.conversation_id)
      .execute();
    await removeFile(file);
  }
  await db()
    .updateTable("agent21_file_deletions")
    .set({ state: "completed" })
    .where("id", "=", id)
    .execute();
  return true;
}
