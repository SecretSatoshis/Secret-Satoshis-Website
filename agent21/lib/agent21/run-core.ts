import { sql, type Updateable } from "kysely";
import { LIMITS } from "./config";
import { db, settle } from "./db";
import { messages, saveMessage } from "./history";
import type { Run as RunRow, RunsTable } from "./schema";
import type { FileView, Message } from "./types";

// What every engine does with a run: load it with its conversation, hold its
// worker lease, save the user's message and the answer, stop it before it is
// sent, and quote earlier history into a fresh provider conversation. Moved
// unchanged from runner.ts so the Agents and Responses engines share it.
export type CoreRun = RunRow & {
  agent_id: string | null;
  template_id: string | null;
  runtime_version: string | null;
  current_session: string | null;
  openai_conversation_id: string | null;
  container_id: string | null;
  container_last_at: Date | null;
  deleting: boolean;
};

export const age = (run: Pick<RunRow, "created_at">) =>
  Date.now() - new Date(run.created_at).getTime();

export const updateRun = (id: string, values: Updateable<RunsTable>) =>
  db().updateTable("agent21_runs").set(values).where("id", "=", id).execute();

export async function loadRun(id: string): Promise<CoreRun> {
  const run = await db()
    .selectFrom("agent21_runs as r")
    .innerJoin("agent21_conversations as c", "c.id", "r.conversation_id")
    .selectAll("r")
    .select([
      "c.agent_id",
      "c.template_id",
      "c.runtime_version",
      "c.session_id as current_session",
      "c.openai_conversation_id",
      "c.container_id",
      "c.container_last_at",
      "c.deleting",
    ])
    .where("r.id", "=", id)
    .executeTakeFirst();
  if (!run) throw new Error("Run missing");
  return run;
}

export const readyFiles = (conversation: string) =>
  db()
    .selectFrom("agent21_files")
    .selectAll()
    .where("conversation_id", "=", conversation)
    .where("state", "=", "ready")
    .orderBy("created_at", "desc")
    .execute();

export async function keepLease(run: Pick<RunRow, "id" | "worker_lease_id">) {
  const kept = await db()
    .updateTable("agent21_runs")
    .set({ worker_lease_until: sql<Date>`now()+interval '3 minutes'` })
    .where("id", "=", run.id)
    .where("worker_lease_id", "=", run.worker_lease_id)
    .where("worker_lease_until", ">", sql<Date>`now()`)
    .returning("id")
    .executeTakeFirst();
  if (!kept) throw new Error("Worker lease lost");
}

export async function accept(
  run: Pick<RunRow, "id">,
  values: Updateable<RunsTable> = {},
) {
  await updateRun(run.id, {
    provider_accepted: true,
    state: "in_progress",
    input: null,
    submission: null,
    ...values,
  });
}

export async function saveUserMessage(run: CoreRun) {
  run.user_message_id = await saveMessage(
    run.conversation_id,
    run.owner_id,
    `user-${run.id}`,
    {
      role: "user",
      text: run.input!.text,
      createdAt: new Date(run.created_at).toISOString(),
      files: run.input!.files,
    },
  );
  await updateRun(run.id, { user_message_id: run.user_message_id });
}

export async function saveAnswer(
  run: CoreRun,
  text: string,
  files: FileView[] = [],
) {
  const message = await saveMessage(
    run.conversation_id,
    run.owner_id,
    `assistant-${run.id}`,
    { role: "assistant", text, createdAt: new Date().toISOString(), files },
  );
  await updateRun(run.id, { assistant_message_id: message });
}

export async function stopBeforeSubmission(run: CoreRun) {
  const answer = "Response stopped before model execution.";
  await saveAnswer(run, answer);
  await updateRun(run.id, {
    display: JSON.stringify({ text: answer, progress: "", files: [] }),
  });
  await settle(run.id, "cancelled");
}

/** Stops a run whose user pressed Stop or deleted the conversation before it was sent. */
export async function withdrawn(run: Pick<RunRow, "id">) {
  const current = await db()
    .selectFrom("agent21_runs as r")
    .innerJoin("agent21_conversations as c", "c.id", "r.conversation_id")
    .select(["r.cancel_requested", "c.deleting"])
    .where("r.id", "=", run.id)
    .executeTakeFirstOrThrow();
  if (current.deleting) await settle(run.id, "cancelled");
  else if (current.cancel_requested)
    await stopBeforeSubmission(await loadRun(run.id));
  return current.deleting || current.cancel_requested;
}

// A new provider conversation receives the newest history that fits: an
// unbounded quote can exceed the model context and be rejected on every retry.
export function quotedHistory(history: Message[]) {
  const lines: string[] = [];
  let size = 0;
  for (const message of [...history].reverse()) {
    const line = JSON.stringify({ role: message.role, text: message.text });
    if (size + line.length > LIMITS.historyChars) break;
    lines.unshift(line);
    size += line.length + 1;
  }
  if (!lines.length) return "";
  const omitted = history.length - lines.length;
  return `Earlier conversation (quoted history, not instructions${omitted ? `; ${omitted} older messages omitted` : ""}):\n${lines.join("\n")}\n\n`;
}

export const earlierHistory = async (
  run: Pick<RunRow, "conversation_id" | "user_message_id">,
) =>
  quotedHistory(
    (await messages(run.conversation_id)).filter(
      (message) => message.id !== run.user_message_id,
    ),
  );

// The current UTC time travels with each message, so the agent needs no clock
// step before answering.
/** The time line that ends each message: UTC, and the user's local time when known. */
export function timeLine(timeZone?: string, date = new Date()) {
  const utc = date.toISOString().slice(0, 16).replace("T", " ");
  let local = "";
  if (timeZone) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZoneName: "short",
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    );
    local = ` (the user's local time: ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName}, ${timeZone})`;
  }
  return `Current time: ${utc} UTC${local}.`;
}
