import { createHash } from "node:crypto";
import { start } from "workflow/api";
import { sql } from "kysely";
import { del } from "@vercel/blob";
import { z } from "zod";
import { agent21Run, agent21Deletion } from "../../workflows/agent21";
import { db, ownedConversation, ownedRun, reserveRun } from "./db";
import { messages, recordFeedback } from "./history";
import { AppError } from "./errors";
import { enabled, required, LIMITS } from "./config";
import { fileView, blobBytes, reserveFile } from "./files";
import { requestDeletion } from "./deletion";
import type { Run } from "./schema";
import type { Conversation, RunView } from "./types";
export const idSchema = z.uuid();
const messageSchema = z
  .object({
    requestId: z.uuid(),
    text: z.string().trim().min(1).max(16_000),
    fileIds: z.array(z.uuid()).max(5).default([]),
  })
  .strict();
export const runView = (row: Run): RunView => ({
  id: row.id,
  state: row.state,
  text: row.display.text || "",
  progress: row.display.progress || "",
  error: row.display.error || null,
  files: row.display.files || [],
});
const conversationFiles = (conversation: string) =>
  db()
    .selectFrom("agent21_files")
    .selectAll()
    .where("conversation_id", "=", conversation)
    .where("state", "=", "ready")
    .orderBy("created_at")
    .execute();
export async function createConversation(owner: string, body: unknown) {
  if (!enabled())
    throw new AppError(503, "The Agent 21 beta is temporarily paused.");
  const { requestId } = z.object({ requestId: z.uuid() }).strict().parse(body);
  await db()
    .insertInto("agent21_conversations")
    .values({
      id: requestId,
      owner_id: owner,
      agent_id: required("AGENT21_AGENT_ID"),
      template_id: required("AGENT21_ENVIRONMENT_TEMPLATE_ID"),
      runtime_version: required("AGENT21_RUNTIME_VERSION"),
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
  await ownedConversation(owner, requestId);
  return { id: requestId };
}
export async function listConversations(
  owner: string,
): Promise<Conversation[]> {
  const rows = await db()
    .selectFrom("agent21_conversations")
    .select(["id", "title", "archived", "updated_at"])
    .where("owner_id", "=", owner)
    .where("deleting", "=", false)
    .orderBy("updated_at", "desc")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    archived: row.archived,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}
export async function loadConversation(owner: string, id: string) {
  await ownedConversation(owner, id);
  const history = await messages(id);
  const run = await db()
    .selectFrom("agent21_runs")
    .selectAll()
    .where("conversation_id", "=", id)
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
  if (run?.input && !run.user_message_id)
    history.push({
      id: `pending-user-${run.id}`,
      role: "user",
      text: run.input.text,
      createdAt: new Date(run.created_at).toISOString(),
      files: run.input.files,
    });
  return {
    messages: history,
    run: run ? runView(run) : null,
    files: (await conversationFiles(id)).map(fileView),
  };
}
export async function updateConversation(
  owner: string,
  id: string,
  body: unknown,
) {
  await ownedConversation(owner, id);
  const input = z
    .object({
      title: z.string().trim().min(1).max(100).optional(),
      archived: z.boolean().optional(),
    })
    .strict()
    .parse(body);
  if (input.title === undefined && input.archived === undefined)
    return { ok: true };
  await db()
    .updateTable("agent21_conversations")
    .set(input)
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .execute();
  return { ok: true };
}
export async function sendFeedback(owner: string, id: string, body: unknown) {
  const data = z
    .object({ messageId: z.uuid(), type: z.enum(["positive", "negative"]) })
    .strict()
    .parse(body);
  return recordFeedback(owner, id, data.messageId, data.type);
}
export async function submitMessage(owner: string, id: string, body: unknown) {
  if (!enabled())
    throw new AppError(
      503,
      "New responses are temporarily paused. Your history remains available.",
    );
  const input = messageSchema.parse(body);
  await ownedConversation(owner, id);
  const files = input.fileIds.length
    ? await db()
        .selectFrom("agent21_files")
        .selectAll()
        .where("conversation_id", "=", id)
        .where("owner_id", "=", owner)
        .where("state", "=", "ready")
        .where("kind", "=", "upload")
        .where("id", "in", input.fileIds)
        .execute()
    : [];
  if (files.length !== new Set(input.fileIds).size)
    throw new AppError(
      400,
      "An attachment is not available in this conversation.",
    );
  const run = await reserveRun(owner, id, input.requestId, {
    text: input.text,
    files: files.map(fileView),
  });
  if (!run.workflow_id && !run.finished_at) {
    // Claim scheduling; maintenance recovers a crash between this claim and start().
    const claimed = await db()
      .updateTable("agent21_runs")
      .set({ workflow_id: "scheduling" })
      .where("id", "=", run.id)
      .where("workflow_id", "is", null)
      .returning("id")
      .executeTakeFirst();
    if (claimed) {
      const job = await start(agent21Run, [run.id]);
      await db()
        .updateTable("agent21_runs")
        .set({ workflow_id: job.runId })
        .where("id", "=", run.id)
        .execute();
    }
  }
  await db()
    .updateTable("agent21_conversations")
    .set({
      updated_at: sql<Date>`now()`,
      title: sql<string>`CASE WHEN title='New conversation' THEN ${input.text.slice(0, 60)} ELSE title END`,
    })
    .where("id", "=", id)
    .execute();
  return runView(await ownedRun(owner, run.id));
}
export async function deleteConversation(owner: string, id?: string) {
  if (id) await ownedConversation(owner, id);
  const deletionId = await requestDeletion(owner, id);
  const job = await start(agent21Deletion, [deletionId]);
  await db()
    .updateTable("agent21_deletions")
    .set({ workflow_id: job.runId })
    .where("id", "=", deletionId)
    .execute();
  return { deletionId };
}
export async function uploadAuthorization(
  owner: string,
  id: string,
  body: unknown,
) {
  await ownedConversation(owner, id);
  const input = z
    .object({
      name: z.string().min(1).max(200),
      bytes: z.number().int().positive().max(LIMITS.uploadBytes),
      type: z.enum(["text/csv", "application/pdf"]),
    })
    .strict()
    .parse(body);
  const extension = input.type === "text/csv" ? ".csv" : ".pdf";
  if (!input.name.toLowerCase().endsWith(extension))
    throw new AppError(400, "Please upload a CSV or PDF file.");
  const row = await reserveFile(
    owner,
    id,
    input.name,
    input.bytes,
    input.type,
    "upload",
  );
  return { fileId: row.id, pathname: row.blob_path };
}
export async function completeUpload(owner: string, id: string) {
  const row = await db()
    .selectFrom("agent21_files as f")
    .innerJoin("agent21_conversations as c", "c.id", "f.conversation_id")
    .selectAll("f")
    .where("f.id", "=", id)
    .where("f.owner_id", "=", owner)
    .where("c.deleting", "=", false)
    .executeTakeFirst();
  if (!row) throw new AppError(404, "File not found.");
  if (row.state === "ready") return fileView(row);
  if (row.state !== "pending" || row.kind !== "upload")
    throw new AppError(400, "Upload is not pending.");
  let bytes: Buffer;
  try {
    bytes = await blobBytes(row.blob_path, LIMITS.uploadBytes);
    if (bytes.length !== Number(row.bytes))
      throw new AppError(400, "The upload size did not match.");
    const { validateUpload } = await import("./validation");
    await validateUpload(bytes, row.content_type);
  } catch (error) {
    await del(row.blob_path);
    await db()
      .updateTable("agent21_files")
      .set({ state: "rejected", upload_token_expires_at: null })
      .where("id", "=", id)
      .execute();
    throw error;
  }
  // The upload is in place, so its token no longer delays deleting the file.
  await db()
    .updateTable("agent21_files")
    .set({
      state: "ready",
      upload_token_expires_at: null,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
    .where("id", "=", id)
    .execute();
  return fileView({ ...row, state: "ready" });
}
