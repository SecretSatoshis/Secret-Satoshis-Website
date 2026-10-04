import { get } from "@vercel/blob";
import { start } from "workflow/api";
import { identity } from "@/lib/agent21/auth";
import { db } from "@/lib/agent21/db";
import { requestFileDeletion } from "@/lib/agent21/deletion";
import { AppError } from "@/lib/agent21/errors";
import { handler } from "@/lib/agent21/http";
import { idSchema } from "@/lib/agent21/service";
import { agent21FileDeletion } from "@/workflows/agent21";

const ownedFile = (owner: string, id: string) =>
  db()
    .selectFrom("agent21_files as f")
    .innerJoin("agent21_conversations as c", "c.id", "f.conversation_id")
    .selectAll("f")
    .where("f.id", "=", id)
    .where("f.owner_id", "=", owner)
    .where("c.deleting", "=", false)
    .executeTakeFirst();
/**
 * Downloads check ownership on every request. Browsers keep a private copy and
 * revalidate with its ETag, so an unchanged file returns a cheap 304.
 */
export const GET = handler<{ id: string }>(async (request, { id }) => {
  const file = await ownedFile(await identity(request), idSchema.parse(id));
  if (!file || file.state !== "ready")
    throw new AppError(404, "File not found.");
  const blob = await get(file.blob_path, {
    access: "private",
    ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
  });
  if (!blob) throw new AppError(404, "File not found.");
  const cache = {
    ETag: blob.blob.etag,
    "Cache-Control": "private, no-cache",
  };
  if (blob.statusCode === 304)
    return new Response(null, { status: 304, headers: cache });
  return new Response(blob.stream, {
    headers: {
      ...cache,
      "Content-Type": file.content_type,
      "Content-Disposition": `${file.content_type === "image/png" ? "inline" : "attachment"}; filename="${file.name}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
export const DELETE = handler<{ id: string }>(async (request, { id }) => {
  const owner = await identity(request);
  const deletionId = await requestFileDeletion(owner, idSchema.parse(id));
  const job = await start(agent21FileDeletion, [deletionId]);
  await db()
    .updateTable("agent21_file_deletions")
    .set({ workflow_id: job.runId })
    .where("id", "=", deletionId)
    .execute();
  return Response.json({ deletionId }, { status: 202 });
});
