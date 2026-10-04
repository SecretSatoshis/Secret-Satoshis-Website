import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { db } from "./db";
import { AppError } from "./errors";
import type { FileView, Message } from "./types";
export async function messages(conversation: string): Promise<Message[]> {
  const rows = await db()
    .selectFrom("agent21_messages")
    .select(["id", "role", "text", "files", "feedback", "created_at"])
    .where("conversation_id", "=", conversation)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    text: row.text,
    createdAt: new Date(row.created_at).toISOString(),
    files: row.files,
    feedback: row.feedback,
  }));
}
/** Idempotent per key: a retried write returns the message saved first. */
export async function saveMessage(
  conversation: string,
  owner: string,
  key: string,
  message: {
    role: Message["role"];
    text: string;
    createdAt: string;
    files?: FileView[];
  },
) {
  const row = await db()
    .insertInto("agent21_messages")
    .values({
      id: randomUUID(),
      conversation_id: conversation,
      owner_id: owner,
      external_id: key,
      role: message.role,
      text: message.text,
      files: JSON.stringify(message.files || []),
      created_at: message.createdAt,
    })
    .onConflict((oc) =>
      oc
        .columns(["conversation_id", "external_id"])
        .doUpdateSet({ external_id: (eb) => eb.ref("excluded.external_id") }),
    )
    .returning("id")
    .executeTakeFirstOrThrow();
  await db()
    .updateTable("agent21_conversations")
    .set({ updated_at: sql<Date>`now()` })
    .where("id", "=", conversation)
    .execute();
  return row.id;
}
export async function recordFeedback(
  owner: string,
  conversation: string,
  message: string,
  type: "positive" | "negative",
) {
  const rows = await db()
    .updateTable("agent21_messages as m")
    .from("agent21_conversations as c")
    .set({ feedback: type })
    .whereRef("c.id", "=", "m.conversation_id")
    .where("m.id", "=", message)
    .where("m.conversation_id", "=", conversation)
    .where("m.owner_id", "=", owner)
    .where("m.role", "=", "assistant")
    .where("c.deleting", "=", false)
    .returning("m.id")
    .execute();
  if (!rows.length) throw new AppError(404, "Message not found.");
  return { ok: true };
}
