import { del, issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { z } from "zod";
import { identity } from "@/lib/agent21/auth";
import { db } from "@/lib/agent21/db";
import { AppError } from "@/lib/agent21/errors";
import { handler } from "@/lib/agent21/http";

/**
 * Presigned browser uploads. Signing runs only for the signed-in owner of a
 * pending upload row; Vercel Blob signs its completion callback separately.
 */
export const POST = handler(async (request) => {
  const body = (await request.json()) as HandleUploadPresignedBody;
  return Response.json(
    await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        const owner = await identity(request);
        const file = await db()
          .selectFrom("agent21_files as f")
          .innerJoin("agent21_conversations as c", "c.id", "f.conversation_id")
          .select(["f.id", "f.content_type", "f.bytes"])
          .where("f.blob_path", "=", pathname)
          .where("f.owner_id", "=", owner)
          .where("f.state", "=", "pending")
          .where("c.deleting", "=", false)
          .executeTakeFirst();
        if (!file) throw new AppError(403, "Upload not authorized.");
        const validUntil = Date.now() + 5 * 60_000;
        await db()
          .updateTable("agent21_files")
          .set({ upload_token_expires_at: new Date(validUntil) })
          .where("id", "=", file.id)
          .execute();
        const limits = {
          allowedContentTypes: [file.content_type],
          maximumSizeInBytes: Number(file.bytes),
          validUntil,
        };
        return {
          token: await issueSignedToken({
            pathname,
            operations: ["put"],
            ...limits,
          }),
          urlOptions: {
            ...limits,
            addRandomSuffix: false,
            allowOverwrite: false,
            tokenPayload: JSON.stringify({ id: file.id }),
          },
        };
      },
      // A file whose conversation began deleting during the upload is discarded.
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const token = z
          .object({ id: z.uuid() })
          .parse(JSON.parse(tokenPayload || "{}"));
        const file = await db()
          .selectFrom("agent21_files as f")
          .innerJoin("agent21_conversations as c", "c.id", "f.conversation_id")
          .select(["f.id", "f.state", "c.deleting"])
          .where("f.id", "=", token.id)
          .executeTakeFirst();
        if (file && !file.deleting && file.state !== "deleting") return;
        await del(blob.url);
        if (file)
          await db()
            .updateTable("agent21_files")
            .set({ state: "rejected" })
            .where("id", "=", file.id)
            .execute();
      },
    }),
  );
});
