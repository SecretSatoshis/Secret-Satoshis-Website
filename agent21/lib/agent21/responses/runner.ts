import type {
  Response,
  ResponseInput,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";
import { LIMITS } from "../config";
import { db, settle } from "../db";
import { logDiagnostic, warnDiagnostic } from "../diagnostics";
import { extractBlocks, parseBlock } from "../blocks";
import {
  blobBytes,
  fileView,
  providerFile,
  reserveFile,
  retainFile,
  safeArtifact,
} from "../files";
import { isProviderError, openai } from "../openai";
import {
  accept,
  age,
  earlierHistory,
  keepLease,
  readyFiles,
  saveAnswer,
  saveUserMessage,
  stopBeforeSubmission,
  timeLine,
  updateRun,
  withdrawn,
  type CoreRun,
} from "../run-core";
import type { RunInput } from "../schema";
import type { FileView } from "../types";
import { recordContainerUsage, recordResponseUsage } from "../usage";
import {
  answerText,
  containersIn,
  createRound,
  functionCalls,
  invalidBlocks,
  readRound,
  repairInput,
  runCalls,
  usageOf,
  type LoopEvent,
} from "./loop";
import { activePrompt, PRIVATE_MARKER } from "./prompt";
import { createParams, engineSettings, type Paths } from "./request";
import { harvest, OUTPUTS } from "./shell";
import type { ToolContext } from "./tools";

// The Responses engine's run, driven by the workflow's tick. Each tick holds
// the run's worker lease and works the answer forward: rounds of
// `responses.create` in the run's OpenAI conversation, with the data tools run
// here between rounds. Progress and the answer as it is written go to the
// run's display, which the browser stream reads. A round always finishes in
// the tick that started it; a tick that stops between rounds (its time budget,
// a deploy) leaves the last response id, and the next tick resumes from it.
const FAILED =
  "Agent 21 could not finish this response. You can send a new message to try again.";
const STOPPED = "Response stopped.";
// A tick stops starting rounds after this, so it ends well inside its limits.
const STEP_BUDGET_MS = 200_000;
// Hosted containers expire after 20 idle minutes; one idle for 18 is not reused.
const CONTAINER_IDLE_MS = 18 * 60_000;
const MAX_ROUNDS = 12;
const DISPLAY_MS = 300;
const TEXT_FILE = /\.(csv|txt|md|json)$/i;
// A request for a file or a spreadsheet goes to the shell; everything else to the data tools.
const FILE_REQUEST =
  /\b(csv|pdf|xlsx|excel|spreadsheet)\b|\b(export|download)\b/i;
const contentTypes: Record<string, string> = {
  png: "image/png",
  csv: "text/csv",
  md: "text/markdown",
  pdf: "application/pdf",
  py: "text/plain",
  json: "application/json",
};

/**
 * The shell joins the data tools only when the request needs it: a file the
 * data tools cannot read, a file the user asks for, or a conversation whose
 * container is still in use. Every other answer runs on the data tools alone.
 */
export function needsShell(
  input: Pick<RunInput, "text" | "files">,
  containerLive: boolean,
) {
  return (
    containerLive ||
    input.files.some((file) => !TEXT_FILE.test(file.name)) ||
    FILE_REQUEST.test(input.text)
  );
}

const containerLive = (run: CoreRun) =>
  Boolean(
    run.container_id &&
    run.container_last_at &&
    Date.now() - new Date(run.container_last_at).getTime() < CONTAINER_IDLE_MS,
  );

/** The run's display, written at most every 300 ms while an answer streams. */
function displayWriter(runId: string) {
  let pending: Record<string, unknown> | undefined;
  let last = 0;
  let timer: NodeJS.Timeout | undefined;
  let writing = Promise.resolve();
  const write = () => {
    timer = undefined;
    if (!pending) return;
    const value = pending;
    pending = undefined;
    last = Date.now();
    writing = writing
      .then(async () => {
        await updateRun(runId, { display: JSON.stringify(value) });
      })
      .catch((error) => {
        logDiagnostic(error, "display_not_saved", { runId, provider: "neon" });
      });
  };
  return {
    set(value: Record<string, unknown>) {
      pending = value;
      if (timer) return;
      timer = setTimeout(write, Math.max(0, DISPLAY_MS - (Date.now() - last)));
    },
    async flush() {
      if (timer) clearTimeout(timer);
      write();
      await writing;
    },
  };
}

/** The OpenAI conversation for this Agent 21 conversation, created on first use. */
async function conversationFor(run: CoreRun) {
  if (run.openai_conversation_id)
    return { id: run.openai_conversation_id, created: false };
  const created = await openai().conversations.create({
    metadata: { conversation: run.conversation_id },
  });
  const claimed = await db()
    .updateTable("agent21_conversations")
    .set({ openai_conversation_id: created.id })
    .where("id", "=", run.conversation_id)
    .where("openai_conversation_id", "is", null)
    .returning("openai_conversation_id")
    .executeTakeFirst();
  if (claimed) return { id: created.id, created: true };
  // Another run created one first; this one is not used.
  await openai()
    .conversations.delete(created.id)
    .catch(() => undefined);
  const row = await db()
    .selectFrom("agent21_conversations")
    .select("openai_conversation_id")
    .where("id", "=", run.conversation_id)
    .executeTakeFirstOrThrow();
  return { id: row.openai_conversation_id!, created: false };
}

/** The message the model reads: earlier history when needed, the files, the time. */
function messageText(
  run: CoreRun,
  files: { selected: string[]; others: string[] },
  shell: boolean,
  history: string,
) {
  const { text, timeZone } = run.input!;
  const notes = [];
  const where = shell
    ? " (read CSV and text files with read_upload; every file is also in /mnt/data for the shell)"
    : " (read them with read_upload)";
  if (files.selected.length)
    notes.push(
      `Files attached to this message: ${files.selected.join(", ")}${where}.`,
    );
  if (files.others.length)
    notes.push(
      `Earlier files in this conversation: ${files.others.join(", ")}.`,
    );
  return `${history}${text}\n\n${notes.length ? notes.join(" ") + "\n" : ""}${timeLine(timeZone)}`;
}

/** The data tools' view of the run: its uploads, and where saved charts go. */
function toolContext(
  run: CoreRun,
  uploads: Awaited<ReturnType<typeof readyFiles>>,
) {
  const files = uploads.filter((file) => file.kind === "upload");
  return {
    log: [],
    now: new Date(),
    uploads: files.map((file) => file.name),
    async readUpload(name: string) {
      const row = files.find((file) => file.name === name);
      if (!row) return null;
      return {
        name,
        bytes: await blobBytes(row.blob_path, LIMITS.uploadBytes),
      };
    },
    async saveArtifact(artifact) {
      const row = await reserveFile(
        run.owner_id,
        run.conversation_id,
        artifact.name,
        artifact.bytes.length,
        artifact.mime,
        "artifact",
        run.id,
        `${run.id}:${artifact.name}`,
      );
      await retainFile(row, artifact.bytes);
      return row.name;
    },
  } satisfies ToolContext;
}

type Totals = {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  searches: number;
};
const zero = (): Totals => ({
  input: 0,
  cached: 0,
  output: 0,
  reasoning: 0,
  searches: 0,
});
function add(totals: Totals, response: Response) {
  const used = usageOf(response);
  totals.input += used.input;
  totals.cached += used.cached;
  totals.output += used.output;
  totals.reasoning += used.reasoning;
  totals.searches += response.output.filter(
    (item) => item.type === "web_search_call",
  ).length;
}

/** Records the answer's spend; a failure here never affects the answer. */
async function recordUsage(run: CoreRun, model: string, tier: string | null) {
  const totals = zero();
  for (const row of await db()
    .selectFrom("agent21_responses")
    .select("id")
    .where("run_id", "=", run.id)
    .execute()) {
    const response = await openai()
      .responses.retrieve(row.id)
      .catch(() => undefined);
    if (response) add(totals, response);
  }
  await recordResponseUsage(run.owner_id, run.conversation_id, run.id, {
    model,
    tier,
    ...totals,
    startedAt: new Date(run.created_at),
  });
}

/** Files the shell left for the user this run, checked as the website requires. */
async function keepShellFiles(run: CoreRun, containerId: string) {
  const refused: string[] = [];
  const full: string[] = [];
  for (const file of await harvest(openai(), containerId)) {
    if (!safeArtifact(file.path, file.bytes, OUTPUTS)) {
      refused.push(file.name);
      continue;
    }
    try {
      const row = await reserveFile(
        run.owner_id,
        run.conversation_id,
        file.name,
        file.bytes.length,
        contentTypes[file.name.split(".").at(-1)!] ??
          "application/octet-stream",
        "artifact",
        run.id,
        `${containerId}:${file.path}:${file.bytes.length}`,
      );
      await retainFile(row, file.bytes);
    } catch (error) {
      if ((error as { status?: number }).status === 413) full.push(file.name);
      else throw error;
    }
  }
  return { refused, full };
}

async function finish(
  run: CoreRun,
  state: "completed" | "failed" | "cancelled",
  text: string,
  settings: { model: string; tier: string | null },
  containerId?: string,
) {
  let answer =
    state === "cancelled"
      ? text || STOPPED
      : state === "failed"
        ? FAILED
        : text || "The response completed without a text answer.";
  // The private prompt never reaches the user, even if the model quotes it.
  if (answer.includes(PRIVATE_MARKER)) {
    warnDiagnostic({ code: "private_marker" }, "answer_withheld", {
      runId: run.id,
    });
    answer = FAILED;
  }
  let notes = "";
  if (containerId && state === "completed") {
    const { refused, full } = await keepShellFiles(run, containerId);
    if (full.length)
      notes += `\n\n_Not saved because your file storage is full: ${full.join(", ")}. Delete files or a conversation to free space._`;
    if (refused.length)
      notes += `\n\n_Not shown because the website could not accept ${refused.length > 1 ? "them" : "it"}: ${refused.join(", ")}. Files must be PNG, CSV, Markdown, PDF, Python or a valid chart, up to 20 MiB._`;
  }
  answer += notes;
  const files: FileView[] = (
    await db()
      .selectFrom("agent21_files")
      .selectAll()
      .where("run_id", "=", run.id)
      .where("kind", "=", "artifact")
      .where("state", "=", "ready")
      .execute()
  ).map(fileView);
  await saveAnswer(run, answer, files);
  for (const found of extractBlocks(answer)) {
    const block = parseBlock(found.language, found.code);
    if (!block.ok)
      warnDiagnostic(
        { code: `invalid_block_${block.type ?? "unknown"}` },
        "answer_block_invalid",
        { runId: run.id },
      );
  }
  await updateRun(run.id, {
    display: JSON.stringify({
      text: answer,
      files,
      error: state === "failed" ? FAILED : null,
      progress: "",
    }),
  });
  await settle(run.id, state);
  await recordUsage(run, settings.model, settings.tier).catch((error) =>
    logDiagnostic(error, "usage_not_recorded", { runId: run.id }),
  );
  if (containerId)
    await recordContainerUsage(
      run.owner_id,
      run.conversation_id,
      containerId,
    ).catch((error) =>
      logDiagnostic(error, "usage_not_recorded", { runId: run.id }),
    );
  return true;
}

/** The run's hard stop: it settles as failed, keeping the question in history. */
export async function abandonResponses(run: CoreRun) {
  if (run.deleting) {
    await settle(run.id, "failed");
    return;
  }
  if (!run.user_message_id) await saveUserMessage(run);
  await saveAnswer(run, FAILED);
  await updateRun(run.id, {
    display: JSON.stringify({ text: FAILED, error: FAILED, progress: "" }),
  });
  await settle(run.id, "failed");
}

const cancelRequested = async (id: string) =>
  Boolean(
    (
      await db()
        .selectFrom("agent21_runs as r")
        .innerJoin("agent21_conversations as c", "c.id", "r.conversation_id")
        .select(["r.cancel_requested", "c.deleting"])
        .where("r.id", "=", id)
        .executeTakeFirst()
    )?.cancel_requested,
  );

/**
 * Works the run forward in this tick. Returns true once it has settled, false
 * when the next tick should continue it.
 */
export async function reconcileResponses(run: CoreRun): Promise<boolean> {
  if (run.finished_at) return true;
  if (age(run) > LIMITS.abandonMs) {
    await abandonResponses(run);
    return true;
  }
  if (run.deleting) {
    await settle(run.id, "cancelled");
    return true;
  }
  if (!run.user_message_id) await saveUserMessage(run);
  if (!run.provider_accepted) {
    if (run.cancel_requested || age(run) > LIMITS.turnMs) {
      await stopBeforeSubmission(run);
      return true;
    }
    if (await withdrawn(run)) return true;
  }

  const tickStarted = Date.now();
  const prompt = await activePrompt();
  const live = containerLive(run);
  const paths: Paths =
    (run.paths as Paths | null) ??
    (run.input && needsShell(run.input, live) ? "BC" : "C");
  const files = await readyFiles(run.conversation_id);
  const uploads = files.filter((file) => file.kind === "upload");
  const shell = paths.includes("B");
  // The shell reads uploads from its container: new containers receive every
  // upload, a reused one only those it has not had yet.
  let fileIds: string[] | undefined;
  if (shell && !live && uploads.length)
    fileIds = await Promise.all(uploads.map(providerFile));
  if (shell && live && uploads.length) {
    const attached = new Set(
      (
        await db()
          .selectFrom("agent21_container_files")
          .select("file_id")
          .where("container_id", "=", run.container_id!)
          .execute()
      ).map((row) => row.file_id),
    );
    for (const file of uploads.filter((f) => !attached.has(f.id))) {
      await openai().containers.files.create(run.container_id!, {
        file_id: await providerFile(file),
      });
      await db()
        .insertInto("agent21_container_files")
        .values({ container_id: run.container_id!, file_id: file.id })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  }
  const settings = engineSettings({
    prompt,
    paths,
    ...(live ? { containerId: run.container_id! } : {}),
    ...(fileIds ? { fileIds } : {}),
    cacheKey: `a21-${run.conversation_id}`,
    metadata: { run: run.id, conversation: run.conversation_id },
  });
  const tier = settings.tier ?? null;
  const params = createParams(settings);
  const conversation = await conversationFor(run);
  const context = toolContext(run, files);
  const display = displayWriter(run.id);
  let progress = "Thinking";
  let note = "";
  let text = new Map<string, string>();
  const show = () =>
    display.set({ progress, note, text: [...text.values()].join("\n\n") });
  const sink = (event: LoopEvent) => {
    if (event.type === "progress") progress = event.label;
    if (event.type === "text") {
      if (event.phase === "commentary") note = (note + event.delta).slice(-240);
      else text.set(event.itemId, (text.get(event.itemId) ?? "") + event.delta);
    }
    show();
  };

  // What the next round sends, or the finished response to settle with.
  let input: ResponseInput | string | undefined;
  let last: Response | undefined;
  let round = run.round;
  let repaired = false;
  if (!run.response_id) {
    const selected = new Set(run.input!.files.map((file) => file.id));
    input = messageText(
      run,
      {
        selected: uploads.filter((f) => selected.has(f.id)).map((f) => f.name),
        others: uploads.filter((f) => !selected.has(f.id)).map((f) => f.name),
      },
      shell,
      // A new OpenAI conversation for a conversation with history (one begun
      // on the Agents engine) starts from its quoted history.
      conversation.created ? await earlierHistory(run) : "",
    );
    await updateRun(run.id, {
      paths,
      prompt_version: prompt.kind === "db" ? prompt.version : null,
    });
  } else {
    // A tick that stopped mid-answer: settle or continue from the last response.
    try {
      last = await openai().responses.retrieve(run.response_id);
    } catch (error) {
      if (!isProviderError(error, 404)) throw error;
      return finish(run, "failed", "", { model: settings.model, tier });
    }
    if (last.status === "queued" || last.status === "in_progress") {
      if (run.cancel_requested)
        return finish(run, "cancelled", "", { model: settings.model, tier });
      return false;
    }
  }

  let containerId = live ? run.container_id! : undefined;
  for (;;) {
    if (last) {
      for (const id of containersIn(last.output)) {
        containerId = id;
        await db()
          .insertInto("agent21_containers")
          .values({ id, conversation_id: run.conversation_id })
          .onConflict((oc) => oc.doNothing())
          .execute();
        // A new container received every upload at creation.
        if (fileIds?.length)
          await db()
            .insertInto("agent21_container_files")
            .values(
              uploads.map((file) => ({ container_id: id, file_id: file.id })),
            )
            .onConflict((oc) => oc.doNothing())
            .execute();
        await db()
          .updateTable("agent21_conversations")
          .set({ container_id: id, container_last_at: new Date() })
          .where("id", "=", run.conversation_id)
          .execute();
      }
      if (last.status === "cancelled" || (await cancelRequested(run.id)))
        return finish(
          run,
          "cancelled",
          answerText(last.output),
          {
            model: settings.model,
            tier,
          },
          containerId,
        );
      if (last.status !== "completed") {
        logDiagnostic(
          { code: last.error?.code ?? last.incomplete_details?.reason },
          "run_failed",
          { runId: run.id, provider: "openai" },
        );
        return finish(run, "failed", "", { model: settings.model, tier });
      }
      const calls = functionCalls(last);
      if (!calls.length) {
        const answer = answerText(last.output);
        const broken = repaired ? [] : invalidBlocks(answer);
        if (!broken.length || round >= MAX_ROUNDS)
          return finish(
            run,
            "completed",
            answer,
            {
              model: settings.model,
              tier,
            },
            containerId,
          );
        repaired = true;
        input = repairInput(broken);
      } else {
        if (round >= MAX_ROUNDS)
          return finish(run, "failed", "", { model: settings.model, tier });
        await keepLease(run);
        input = await runCalls(calls, context, (tool) => {
          progress = tool.ok ? progress : "Checking a data source";
          show();
        });
      }
    }
    if (age(run) > LIMITS.turnMs)
      return finish(run, "failed", "", { model: settings.model, tier });
    if (Date.now() - tickStarted > STEP_BUDGET_MS) {
      await display.flush();
      return false;
    }
    if (await cancelRequested(run.id))
      return finish(
        run,
        "cancelled",
        "",
        { model: settings.model, tier },
        containerId,
      );
    await keepLease(run);
    text = new Map();
    const abort = new AbortController();
    const watch = setInterval(() => {
      cancelRequested(run.id)
        .then((stop) => stop && abort.abort())
        .catch(() => undefined);
    }, 1000);
    try {
      const stream = await createRound(openai(), {
        ...params,
        input: input!,
        conversation: conversation.id,
        stream: true,
      });
      round += 1;
      const recording: Promise<unknown>[] = [];
      const read = await readRound(
        (async function* () {
          for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
            if (abort.signal.aborted) {
              (stream as { controller?: AbortController }).controller?.abort();
              return;
            }
            if (event.type === "response.created") {
              const id = event.response.id;
              recording.push(
                db()
                  .insertInto("agent21_responses")
                  .values({
                    id,
                    conversation_id: run.conversation_id,
                    run_id: run.id,
                  })
                  .onConflict((oc) => oc.doNothing())
                  .execute()
                  .then(async () => {
                    if (round === 1 && !run.provider_accepted)
                      await accept(run, { response_id: id, round });
                    else await updateRun(run.id, { response_id: id, round });
                  }),
              );
            }
            yield event;
          }
        })(),
        sink,
        round,
      ).catch((error) => {
        if (abort.signal.aborted) return undefined;
        throw error;
      });
      await Promise.all(recording);
      if (!read) {
        await display.flush();
        return finish(
          run,
          "cancelled",
          [...text.values()].join("\n\n"),
          { model: settings.model, tier },
          containerId,
        );
      }
      last = read.response;
      run.provider_accepted = true;
    } finally {
      clearInterval(watch);
    }
    await display.flush();
  }
}
