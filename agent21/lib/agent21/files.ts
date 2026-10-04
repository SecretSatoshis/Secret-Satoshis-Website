import { createHash, randomUUID } from "node:crypto";
import { put, get, del } from "@vercel/blob";
import { AppError } from "./errors";
import { LIMITS } from "./config";
import { db, userTransaction } from "./db";
import { isProviderError, openai } from "./openai";
import type { FileRow } from "./schema";
import type { FileView } from "./types";
export const fileView = (row: FileRow): FileView => ({
  id: row.id,
  name: row.name,
  type: row.content_type,
  bytes: Number(row.bytes),
  kind: row.kind,
});
export function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(-120) || "file";
}
export function safeArtifact(path: string, bytes: Buffer) {
  if (
    !/^\/workspace\/outputs\/[a-zA-Z0-9_.-]+\.(png|csv|md|pdf|py)$/.test(path)
  )
    return false;
  if (bytes.length > LIMITS.outputBytes) return false;
  const text = bytes.toString("utf8");
  return !/AGENT21_PRIVATE_CONTROL|BEGIN (?:[A-Z]+ )?PRIVATE KEY|sk-(?:proj-|live-)[a-zA-Z0-9_-]{20,}/.test(
    text,
  );
}
/** Reads a response body, failing as soon as it exceeds max bytes. */
export async function boundedBytes(response: Response, max: number) {
  if (Number(response.headers.get("content-length") || 0) > max)
    throw new AppError(413, "The source response is too large.");
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max)
        throw new AppError(413, "The source response is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
/** Blob paths are unique per file and never overwritten, so cached reads are current. */
export async function blobBytes(path: string, max: number) {
  const blob = await get(path, { access: "private" });
  if (!blob || blob.statusCode !== 200)
    throw new AppError(404, "File not found.");
  return boundedBytes(new Response(blob.stream), max);
}
export const inputPath = (row: Pick<FileRow, "id" | "name">) =>
  `/workspace/inputs/${row.id}/${row.name}`;
export async function reserveFile(
  owner: string,
  conversation: string,
  name: string,
  bytes: number,
  type: string,
  kind: FileView["kind"],
  runId?: string,
  artifactKey?: string,
  provenance?: Record<string, unknown>,
) {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    bytes > (kind === "upload" ? LIMITS.uploadBytes : LIMITS.outputBytes)
  )
    throw new AppError(413, "File exceeds the beta size limits.");
  return userTransaction(owner, async (trx) => {
    const allowed = await trx
      .selectFrom("agent21_conversations")
      .select("id")
      .where("id", "=", conversation)
      .where("owner_id", "=", owner)
      .where("deleting", "=", false)
      .executeTakeFirst();
    if (!allowed) throw new AppError(404, "Conversation not found.");
    if (artifactKey) {
      const existing = await trx
        .selectFrom("agent21_files")
        .selectAll()
        .where("artifact_key", "=", artifactKey)
        .executeTakeFirst();
      if (existing) return existing;
    }
    const counts = await trx
      .selectFrom("agent21_files")
      .select((eb) => [
        eb.fn
          .coalesce(
            eb.fn.sum<number>("bytes").filterWhere("state", "<>", "rejected"),
            eb.lit(0),
          )
          .as("bytes"),
        eb.fn
          .countAll<number>()
          .filterWhere((w) =>
            w.and([
              w("conversation_id", "=", conversation),
              w("kind", "=", "upload"),
              w("state", "<>", "rejected"),
            ]),
          )
          .as("attachments"),
      ])
      .where("owner_id", "=", owner)
      .executeTakeFirstOrThrow();
    if (
      Number(counts.bytes) + bytes > LIMITS.storageBytes ||
      (kind === "upload" && Number(counts.attachments) >= LIMITS.attachments)
    )
      throw new AppError(
        413,
        "Your beta file-storage allowance is full. Delete files or a conversation to continue.",
      );
    const id = randomUUID();
    const safe = safeFilename(name);
    return trx
      .insertInto("agent21_files")
      .values({
        id,
        owner_id: owner,
        conversation_id: conversation,
        run_id: runId || null,
        kind,
        name: safe,
        content_type: type,
        bytes,
        blob_path: `agent21/${owner}/${conversation}/${id}/${safe}`,
        artifact_key: artifactKey || null,
        provenance: provenance ? JSON.stringify(provenance) : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}
export async function retainFile(row: FileRow, bytes: Buffer) {
  if (row.state === "ready") return;
  await put(row.blob_path, bytes, {
    access: "private",
    addRandomSuffix: false,
    contentType: row.content_type,
    allowOverwrite: true,
  });
  await db()
    .updateTable("agent21_files")
    .set({
      state: "ready",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
    .where("id", "=", row.id)
    .execute();
}
/** The file's copy in the OpenAI Files API, uploaded once and reused by every sandbox. */
export async function providerFile(row: FileRow) {
  if (row.openai_file_id) return row.openai_file_id;
  const bytes = await blobBytes(
    row.blob_path,
    row.kind === "upload" ? LIMITS.uploadBytes : LIMITS.outputBytes,
  );
  // No automatic retry: a duplicate upload after a lost response would leave
  // an untracked copy of the user's file that deletion could not find.
  const file = await openai().files.create(
    {
      file: new File([new Uint8Array(bytes)], row.name, {
        type: row.content_type,
      }),
      purpose: "user_data",
    },
    { maxRetries: 0 },
  );
  await db()
    .updateTable("agent21_files")
    .set({ openai_file_id: file.id })
    .where("id", "=", row.id)
    .execute();
  row.openai_file_id = file.id;
  return file.id;
}
async function present(environment: string, path: string) {
  const directory = path.slice(0, path.lastIndexOf("/"));
  for await (const file of openai().beta.agents.environments.files.list(
    environment,
    { path: directory },
  ))
    if (file.path === path) return true;
  return false;
}
/**
 * Copies a retained file into a connected sandbox. A destination that already
 * exists returns 400, and an unexpected install error returns 500; both are
 * checked against the sandbox, so a lost response or an earlier copy is not a
 * failure.
 */
export async function attachToEnvironment(
  row: FileRow,
  environment: string,
  path = inputPath(row),
) {
  const fileId = await providerFile(row);
  try {
    await openai().beta.agents.environments.files.create(environment, {
      type: "file_id",
      file_id: fileId,
      path,
    });
  } catch (error) {
    if (
      !isProviderError(error, 400, 500) ||
      !(await present(environment, path).catch(() => false))
    )
      throw error;
  }
}
export async function removeFile(row: FileRow) {
  await del(row.blob_path);
  if (row.openai_file_id) {
    try {
      await openai().files.delete(row.openai_file_id);
    } catch (error) {
      if (!isProviderError(error, 404)) throw error;
    }
  }
  await db().deleteFrom("agent21_files").where("id", "=", row.id).execute();
}
