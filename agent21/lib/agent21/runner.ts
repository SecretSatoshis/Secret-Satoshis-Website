import { randomUUID } from "node:crypto";
import { sql, type Updateable } from "kysely";
import type { AgentSession } from "openai/resources/beta/agents/agents";
import type { SessionCreateParamsNonStreaming } from "openai/resources/beta/agents/sessions/sessions";
import type { Turn } from "openai/resources/beta/agents/sessions/turns";
import { db, settle } from "./db";
import { messages, saveMessage } from "./history";
import {
  openai,
  publicText,
  estimatedTokens,
  containerCost,
  canonicalData,
  turnItems,
  environmentId,
  hostedEnvironment,
  isProviderError,
  sessionTools,
} from "./openai";
import {
  attachToEnvironment,
  boundedBytes,
  fileView,
  inputPath,
  providerFile,
  retainFile,
  reserveFile,
  safeArtifact,
} from "./files";
import { LIMITS } from "./config";
import { logDiagnostic } from "./diagnostics";
import { AppError } from "./errors";
import { terminal, type FileView, type Message } from "./types";
import type {
  FileRow,
  MessageSubmission,
  Run as RunRow,
  RunsTable,
  SessionSubmission,
} from "./schema";

type Run = RunRow & {
  agent_id: string;
  template_id: string;
  runtime_version: string;
  current_session: string | null;
  deleting: boolean;
};
const FAILED =
  "Agent 21 could not finish this response. You can send a new message to try again.";
const age = (run: Run) => Date.now() - new Date(run.created_at).getTime();
const minutes = (run: Run) => age(run) / 60_000;
// Session creation includes at most this many files; sessions accept 50.
const SESSION_FILES = 50;

const updateRun = (id: string, values: Updateable<RunsTable>) =>
  db().updateTable("agent21_runs").set(values).where("id", "=", id).execute();
async function load(id: string): Promise<Run> {
  const run = await db()
    .selectFrom("agent21_runs as r")
    .innerJoin("agent21_conversations as c", "c.id", "r.conversation_id")
    .selectAll("r")
    .select([
      "c.agent_id",
      "c.template_id",
      "c.runtime_version",
      "c.session_id as current_session",
      "c.deleting",
    ])
    .where("r.id", "=", id)
    .executeTakeFirst();
  if (!run) throw new Error("Run missing");
  return run;
}
const readyFiles = (conversation: string) =>
  db()
    .selectFrom("agent21_files")
    .selectAll()
    .where("conversation_id", "=", conversation)
    .where("state", "=", "ready")
    .orderBy("created_at", "desc")
    .execute();
// Nothing reached the provider: no message was sent, and a session creation
// either never started or was confirmed absent from the provider's listing.
const unsent = (run: Run) =>
  !run.submission ||
  (run.submission.kind === "session" && !run.session_creation_started_at);
async function keepLease(run: Run) {
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
// A reused sandbox already holds earlier files; copy each file once per session.
async function attachOnce(session: AgentSession, file: FileRow, path?: string) {
  await attachToEnvironment(file, environmentId(session), path);
  await recordSessionFiles(session.id, [file.id]);
}
async function recordSessionFiles(session: string, files: string[]) {
  if (!files.length) return;
  await db()
    .insertInto("agent21_session_files")
    .values(files.map((file_id) => ({ session_id: session, file_id })))
    .onConflict((oc) => oc.doNothing())
    .execute();
}
async function findCreatedSession(run: Run) {
  for await (const candidate of openai().beta.agents.sessions.list({
    order: "desc",
    limit: 100,
  })) {
    if (
      candidate.metadata.run === run.id &&
      candidate.metadata.conversation === run.conversation_id &&
      candidate.metadata.runtime === run.runtime_version
    )
      return candidate;
    if (
      candidate.created_at * 1000 <
      new Date(run.session_creation_started_at!).getTime() - 1000
    )
      return undefined;
  }
}
async function adoptSession(run: Run, session: AgentSession) {
  await db()
    .insertInto("agent21_sessions")
    .values({
      id: session.id,
      conversation_id: run.conversation_id,
      environment_id: environmentId(session),
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
  await db()
    .updateTable("agent21_conversations")
    .set({ session_id: session.id })
    .where("id", "=", run.conversation_id)
    .execute();
  await updateRun(run.id, { session_id: session.id, state: "submitting" });
  run.session_id = session.id;
}
async function accept(run: Run, values: Updateable<RunsTable> = {}) {
  await updateRun(run.id, {
    provider_accepted: true,
    state: "in_progress",
    input: null,
    submission: null,
    ...values,
  });
}
async function saveUserMessage(run: Run) {
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
async function saveAnswer(run: Run, text: string, files: FileView[] = []) {
  const message = await saveMessage(
    run.conversation_id,
    run.owner_id,
    `assistant-${run.id}`,
    { role: "assistant", text, createdAt: new Date().toISOString(), files },
  );
  await updateRun(run.id, { assistant_message_id: message });
}
async function stopBeforeSubmission(run: Run) {
  const answer = "Response stopped before model execution.";
  await saveAnswer(run, answer);
  await updateRun(run.id, {
    display: JSON.stringify({ text: answer, progress: "", files: [] }),
  });
  await settle(
    run.id,
    "cancelled",
    run.session_id ? containerCost(minutes(run)) : 0,
    true,
  );
}
/** Stops a run whose user pressed Stop or deleted the conversation before it was sent. */
async function withdrawn(run: Run) {
  const current = await db()
    .selectFrom("agent21_runs as r")
    .innerJoin("agent21_conversations as c", "c.id", "r.conversation_id")
    .select(["r.cancel_requested", "c.deleting"])
    .where("r.id", "=", run.id)
    .executeTakeFirstOrThrow();
  if (current.deleting) await settle(run.id, "cancelled", 0, unsent(run));
  else if (current.cancel_requested)
    await stopBeforeSubmission(await load(run.id));
  return current.deleting || current.cancel_requested;
}
// A new session receives the newest history that fits: an unbounded quote can
// exceed the model context and be rejected on every retry.
function quotedHistory(history: Message[]) {
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
const earlierHistory = async (run: Run) =>
  quotedHistory(
    (await messages(run.conversation_id)).filter(
      (message) => message.id !== run.user_message_id,
    ),
  );
function messageText(run: Run) {
  const selected = run.input!.files.map(inputPath);
  return `${run.input!.text}\n\nFiles selected for this message: ${selected.join(", ") || "none"}. Retained inputs from this conversation are restored under /workspace/inputs.`;
}
/** The conversation's current session, unless its sandbox has expired or failed. */
async function reusableSession(run: Run) {
  if (!run.current_session) return undefined;
  try {
    const session = await openai().beta.agents.sessions.retrieve(
      run.current_session,
    );
    if (session.status === "failed") return undefined;
    const environment = await openai().beta.agents.environments.retrieve(
      environmentId(session),
    );
    // OpenAI-hosted sandboxes do not come back after they expire: the
    // conversation continues in a new session with its files and history.
    return environment.status === "connected" ||
      environment.status === "pending"
      ? session
      : undefined;
  } catch (error) {
    if (isProviderError(error, 404)) return undefined;
    throw error;
  }
}
/**
 * Creates the conversation's session with the message and its files in one
 * request. Session creation has no idempotency key, so the SDK must not retry
 * it: a lost response is recovered from the provider's session listing (see
 * start), and only a creation confirmed absent is sent again, unchanged.
 */
async function createSession(run: Run) {
  let submission =
    run.submission?.kind === "session" ? run.submission : undefined;
  if (!submission) {
    if (await withdrawn(run)) return;
    const files = (await readyFiles(run.conversation_id)).slice(
      0,
      SESSION_FILES,
    );
    const environmentFiles = [];
    for (const file of files) {
      await keepLease(run);
      environmentFiles.push({
        type: "file_id" as const,
        file_id: await providerFile(file),
        path: inputPath(file),
      });
    }
    submission = {
      kind: "session",
      body: canonicalData({
        agent_id: run.agent_id,
        environment: hostedEnvironment(run.template_id, environmentFiles),
        input: (await earlierHistory(run)) + messageText(run),
        metadata: {
          conversation: run.conversation_id,
          run: run.id,
          runtime: run.runtime_version,
        },
      }),
    } satisfies SessionSubmission;
  } else if (await withdrawn(run)) return;
  await updateRun(run.id, {
    submission: JSON.stringify(submission),
    prior_turn_ids: "[]",
    session_creation_started_at: new Date(),
  });
  // The data server's credential joins the request here and is never stored.
  const session = await openai().beta.agents.sessions.create(
    {
      ...submission.body,
      agent: { tools: await sessionTools(run.agent_id) },
    } as unknown as SessionCreateParamsNonStreaming,
    { maxRetries: 0 },
  );
  await adoptSession(run, session);
  await acceptCreated(run, submission);
}
/** A created session already holds the message and the files listed in its body. */
async function acceptCreated(run: Run, submission: SessionSubmission) {
  const environment = submission.body.environment as {
    files?: { path: string }[];
  };
  await recordSessionFiles(
    run.session_id!,
    (environment.files ?? []).map(({ path }) => path.split("/")[3]),
  );
  await accept(run);
}
/** Sends the message to the conversation's reused session. */
async function submitMessage(run: Run) {
  const api = openai();
  if (run.submission?.kind === "message" && run.cancel_requested) {
    // The message may or may not have reached the provider: find its turn,
    // cancel whatever is running and settle once the outcome is known.
    const turns = (
      await api.beta.agents.sessions.turns.list(run.session_id!, {
        order: "desc",
        limit: 20,
      })
    ).data;
    const found = turns.find(
      (t) => !t.subagent_id && !(run.prior_turn_ids || []).includes(t.id),
    );
    await api.beta.agents.sessions.events.create(run.session_id!, {
      events: [{ type: "agent.session.input.cancel" }],
    });
    if (found) await accept(run, { turn_id: found.id });
    else if (age(run) > LIMITS.turnMs)
      await settle(run.id, "cancelled", 0, false);
    return;
  }
  let submission =
    run.submission?.kind === "message" ? run.submission : undefined;
  if (!submission) {
    const session = await api.beta.agents.sessions.retrieve(run.session_id!);
    const environment = await api.beta.agents.environments.retrieve(
      environmentId(session),
    );
    if (environment.status === "pending") return;
    if (environment.status !== "connected" || session.status === "failed") {
      // The sandbox ended after it was chosen; the next pass starts a new session.
      await updateRun(run.id, { session_id: null, state: "queued" });
      await db()
        .updateTable("agent21_conversations")
        .set({ session_id: null })
        .where("id", "=", run.conversation_id)
        .where("session_id", "=", session.id)
        .execute();
      return;
    }
    if (await withdrawn(run)) return;
    const attached = new Set(
      (
        await db()
          .selectFrom("agent21_session_files")
          .select("file_id")
          .where("session_id", "=", session.id)
          .execute()
      ).map((row) => row.file_id),
    );
    for (const file of await readyFiles(run.conversation_id)) {
      if (attached.has(file.id)) continue;
      await keepLease(run);
      await attachOnce(session, file);
    }
    const prior = (
      await api.beta.agents.sessions.turns.list(session.id, {
        order: "desc",
        limit: 20,
      })
    ).data.map((t) => t.id);
    const context = prior.length ? "" : await earlierHistory(run);
    submission = {
      kind: "message",
      "Idempotency-Key": `message-${run.id}`,
      events: [
        {
          type: "agent.session.input.message",
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: context + messageText(run) },
              ],
            },
          ],
        },
      ],
    } satisfies MessageSubmission;
    await updateRun(run.id, {
      submission: JSON.stringify(submission),
      prior_turn_ids: JSON.stringify(prior),
    });
    if (await withdrawn(run)) return;
  }
  // An ambiguous network response is retried with exactly the persisted
  // payload and Idempotency-Key, so the provider accepts the message once.
  const { kind, ...params } = submission;
  await api.beta.agents.sessions.events.create(
    run.session_id!,
    canonicalData(params) as Parameters<
      typeof api.beta.agents.sessions.events.create
    >[1],
  );
  await accept(run);
}
/** Delivers the run's message to the provider: a reused session or a new one. */
async function start(run: Run) {
  // Resolve a creation whose response was lost before Stop, deletion or a retry,
  // so none of them leaves an untracked sandbox behind or waits on it forever.
  if (run.session_creation_started_at && !run.session_id) {
    const created = await findCreatedSession(run);
    if (created && run.submission?.kind === "session") {
      await adoptSession(run, created);
      await acceptCreated(run, run.submission);
      return;
    }
    if (
      Date.now() - new Date(run.session_creation_started_at).getTime() <
      LIMITS.creationSettleMs
    )
      return;
    // The provider never created it (e.g. a rate limit), so it is sent again.
    await updateRun(run.id, { session_creation_started_at: null });
    run.session_creation_started_at = null;
  }
  if (run.session_id && run.submission?.kind === "session") {
    await acceptCreated(run, run.submission);
    return;
  }
  if (run.deleting) {
    await settle(run.id, "cancelled", 0, unsent(run));
    return;
  }
  if (!run.user_message_id) await saveUserMessage(run);
  if ((run.cancel_requested || age(run) > LIMITS.turnMs) && unsent(run)) {
    await stopBeforeSubmission(run);
    return;
  }
  if (run.session_id || run.submission?.kind === "message") {
    await submitMessage(run);
    return;
  }
  if (!run.submission) {
    const session = await reusableSession(run);
    if (session) {
      await adoptSession(run, session);
      await submitMessage(run);
      return;
    }
  }
  await createSession(run);
}
const contentTypes: Record<string, string> = {
  png: "image/png",
  csv: "text/csv",
  md: "text/markdown",
  pdf: "application/pdf",
  py: "text/plain",
};
async function finishRun(run: Run, turn: Turn, text: string) {
  const api = openai();
  if (run.finished_at) return;
  const state = turn.status as "completed" | "failed" | "cancelled";
  const tokens = estimatedTokens(turn.usage);
  const cost = (tokens || 0) + containerCost(minutes(run));
  if (run.deleting) {
    await settle(run.id, state, cost, tokens !== null);
    return;
  }
  const notRetained: string[] = [];
  if (state === "completed") {
    for await (const artifact of api.beta.agents.sessions.artifacts.list(
      run.session_id!,
    )) {
      await keepLease(run);
      if (
        artifact.turn_id !== turn.id ||
        artifact.size_bytes > LIMITS.outputBytes
      )
        continue;
      const response = await api.beta.agents.sessions.artifacts.content(
        artifact.id,
        { session_id: run.session_id! },
      );
      const bytes = await boundedBytes(response, LIMITS.outputBytes);
      if (!safeArtifact(artifact.path, bytes)) continue;
      const name = artifact.path.split("/").at(-1)!;
      let file;
      try {
        file = await reserveFile(
          run.owner_id,
          run.conversation_id,
          name,
          bytes.length,
          contentTypes[name.split(".").at(-1)!],
          "artifact",
          run.id,
          `${run.session_id}:${artifact.id}`,
        );
      } catch (error) {
        // A full storage allowance is permanent until the user deletes files:
        // deliver the answer without this file instead of retrying forever.
        if (!(error instanceof AppError && error.status === 413)) throw error;
        notRetained.push(name);
        continue;
      }
      await retainFile(file, bytes);
    }
  }
  const files = (
    await db()
      .selectFrom("agent21_files")
      .selectAll()
      .where("run_id", "=", run.id)
      .where("kind", "=", "artifact")
      .where("state", "=", "ready")
      .execute()
  ).map(fileView);
  const error = state === "failed" ? FAILED : null;
  const answer =
    (text ||
      (state === "cancelled"
        ? "Response stopped."
        : error || "The response completed without a text answer.")) +
    (notRetained.length
      ? `\n\n_Not saved because your file storage is full: ${notRetained.join(", ")}. Delete files or a conversation to free space._`
      : "");
  await saveAnswer(run, answer, files);
  await updateRun(run.id, {
    display: JSON.stringify({ text: answer, files, error, progress: "" }),
  });
  await settle(run.id, state, cost, tokens !== null);
}
// The hard stop for every phase. A run that cannot finish (a rejected
// submission, a provider or storage failure) must not hold the user's only
// active slot indefinitely.
async function abandonRun(run: Run) {
  if (run.provider_accepted && run.session_id && !run.deleting)
    await openai()
      .beta.agents.sessions.events.create(run.session_id, {
        events: [{ type: "agent.session.input.cancel" }],
      })
      .catch((failure) =>
        logDiagnostic(failure, "run_failed", {
          runId: run.id,
          provider: "openai",
        }),
      );
  if (!run.deleting) {
    // Keep the question in history even when the run never reached the provider.
    if (!run.user_message_id && run.input) await saveUserMessage(run);
    await saveAnswer(run, run.display?.text || FAILED);
  }
  await updateRun(run.id, {
    display: JSON.stringify({
      text: run.display?.text || "",
      progress: "",
      files: [],
      error: FAILED,
    }),
  });
  // Usage is unknown, so nothing is estimated for this run.
  await settle(run.id, "failed", 0, false);
}
/** Follows an accepted run: tool calls, live text, Stop and the final answer. */
async function monitor(run: Run) {
  const api = openai();
  const session = await api.beta.agents.sessions.retrieve(run.session_id!);
  if (run.cancel_requested || run.deleting || age(run) > LIMITS.turnMs)
    await api.beta.agents.sessions.events.create(session.id, {
      events: [{ type: "agent.session.input.cancel" }],
    });
  const turns = await api.beta.agents.sessions.turns.list(session.id, {
    order: "desc",
    limit: 10,
  });
  const turn = run.turn_id
    ? turns.data.find((t) => t.id === run.turn_id)
    : turns.data.find(
        (t) => !t.subagent_id && !(run.prior_turn_ids || []).includes(t.id),
      );
  if (!turn) {
    // Initial input fails asynchronously when the session's sandbox cannot start.
    if (session.status === "failed") {
      await abandonRun(run);
      return true;
    }
    return false;
  }
  const text = publicText(await turnItems(session.id, turn.id));
  await updateRun(run.id, {
    turn_id: turn.id,
    display: JSON.stringify({
      text,
      progress: "Working on your response…",
    }),
  });
  if (!terminal(turn.status)) return false;
  await finishRun(await load(run.id), turn, text);
  return true;
}
async function reconcile(id: string): Promise<boolean> {
  const run = await load(id);
  if (run.finished_at) return true;
  if (age(run) > LIMITS.abandonMs) {
    await abandonRun(run);
    return true;
  }
  if (!run.provider_accepted) {
    await start(run);
    return false;
  }
  return monitor(run);
}
export async function markUncertain(id: string) {
  await db()
    .updateTable("agent21_runs")
    .set({
      state: "unknown",
      display: JSON.stringify({
        progress: "",
        text: "",
        error:
          "This response is taking longer than expected. Agent 21 is still checking on it and will finish or stop it automatically within 15 minutes of sending.",
      }),
    })
    .where("id", "=", id)
    .where("finished_at", "is", null)
    .execute();
}
// Retrying cannot fix a request the provider or the app rejected as invalid.
const permanent = (error: unknown) =>
  isProviderError(error, 400, 401, 403, 404, 422) ||
  (error instanceof AppError && [400, 404, 413].includes(error.status));
/**
 * Advances a run by one step. Returns true once it has settled. Temporary
 * failures throw a sanitized reference for the caller to retry; permanent
 * ones fail the run immediately instead of at the hard stop.
 */
export async function reconcileRun(id: string): Promise<boolean> {
  const lease = randomUUID();
  const claimed = await db()
    .updateTable("agent21_runs")
    .set({
      worker_lease_id: lease,
      worker_lease_until: sql<Date>`now()+interval '3 minutes'`,
    })
    .where("id", "=", id)
    .where("finished_at", "is", null)
    .where((eb) =>
      eb.or([
        eb("worker_lease_until", "is", null),
        eb("worker_lease_until", "<", sql<Date>`now()`),
      ]),
    )
    .returning("id")
    .executeTakeFirst();
  if (!claimed) {
    const run = await db()
      .selectFrom("agent21_runs")
      .select("finished_at")
      .where("id", "=", id)
      .executeTakeFirst();
    return !run || Boolean(run.finished_at);
  }
  try {
    const settled = await reconcile(id);
    // A run that recovers after a delay is no longer shown as delayed.
    if (!settled)
      await db()
        .updateTable("agent21_runs")
        .set({ state: "in_progress" })
        .where("id", "=", id)
        .where("state", "=", "unknown")
        .where("provider_accepted", "=", true)
        .execute();
    return settled;
  } catch (error) {
    const record = logDiagnostic(error, "run_failed", { runId: id });
    await updateRun(id, {
      last_diagnostic: JSON.stringify(record),
      last_error_at: new Date(),
    }).catch((failure) =>
      logDiagnostic(failure, "diagnostic_persist_failed", {
        runId: id,
        provider: "neon",
      }),
    );
    if (permanent(error)) {
      const failed = await load(id)
        .then(abandonRun)
        .then(
          () => true,
          (failure) => {
            logDiagnostic(failure, "run_failed", { runId: id });
            return false;
          },
        );
      if (failed) return true;
    }
    // Workflow error records must not retain raw provider error bodies.
    throw new Error(
      `Agent 21 run reconciliation failed. Reference: ${record.id}`,
    );
  } finally {
    await db()
      .updateTable("agent21_runs")
      .set({ worker_lease_id: null, worker_lease_until: null })
      .where("id", "=", id)
      .where("worker_lease_id", "=", lease)
      .execute();
  }
}
/** Seconds between checks when no webhook arrives: events wake the loop sooner. */
export const pollSeconds = () => (process.env.OPENAI_WEBHOOK_SECRET ? 30 : 5);
export const runHookToken = (id: string) => `agent21-run:${id}`;
/** One workflow step: never throws, so a temporary failure cannot exhaust step retries. */
export async function advanceRun(id: string) {
  try {
    return {
      status: (await reconcileRun(id)) ? "done" : "waiting",
      poll: pollSeconds(),
    } as const;
  } catch {
    // reconcileRun has recorded a sanitized diagnostic for this failure.
    return { status: "failed", poll: pollSeconds() } as const;
  }
}
