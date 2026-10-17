import type { AgentSessionItem } from "openai/resources/beta/agents/agents";
import { resumeHook } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";
import { ownedRun } from "./db";
import { runView } from "./service";
import { terminal } from "./types";
import { environmentId, openai, publicText, turnItems } from "./openai";
import { activity, note, progressFromItems, waiting } from "./progress";
import { runHookToken } from "./runner";
import { runEngine } from "./engine";

const ENDED = [
  "agent.session.turn.completed",
  "agent.session.turn.failed",
  "agent.session.turn.cancelled",
];
const SANDBOX_READY = [
  "agent.session.environment.ready",
  "agent.session.environment.connected",
];
/**
 * Wakes the workflow that drives the run as soon as the turn ends, so the
 * answer is saved at once rather than at its next timer. Webhooks do the same
 * in production; a loopback origin receives none.
 */
const wake = (id: string, type: string) =>
  resumeHook(runHookToken(id), { type }).catch((error) => {
    if (!HookNotFoundError.is(error)) throw error;
  });
export function runStream(owner: string, id: string, signal: AbortSignal) {
  const encoder = new TextEncoder();
  let stopped = false;
  let abort: (() => void) | undefined;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => {
        if (!stopped)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
          );
      };
      signal.addEventListener(
        "abort",
        () => {
          stopped = true;
          abort?.();
        },
        { once: true },
      );
      const settled = (state: string) => terminal(state) || state === "unknown";
      // The stream closes after 45 seconds; the browser reconnects after half a
      // second instead of its default of about three.
      if (!stopped) controller.enqueue(encoder.encode("retry: 500\n\n"));
      try {
        const deadline = Date.now() + 45_000;
        let streamed = false;
        // The Responses engine writes progress and the answer as it is
        // written to the run's display; the stream relays each change.
        if (runEngine(await ownedRun(owner, id)) === "responses") {
          let shownProgress = "";
          let shownText = "";
          let first = true;
          while (!stopped && Date.now() < deadline) {
            const row = await ownedRun(owner, id);
            if (first || settled(row.state)) {
              send({ type: "snapshot", run: runView(row) });
              first = false;
              shownText = row.display.text ?? "";
            }
            if (settled(row.state)) break;
            const progress = JSON.stringify({
              progress: row.display.progress ?? "Thinking",
              note: row.display.note ?? "",
            });
            if (progress !== shownProgress) {
              shownProgress = progress;
              send({ type: "progress", ...JSON.parse(progress) });
            }
            const text = row.display.text ?? "";
            if (text && text !== shownText) {
              shownText = text;
              send({ type: "text", text });
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          return;
        }
        while (!stopped && Date.now() < deadline) {
          const row = await ownedRun(owner, id);
          // After the provider stream ends, send only the settled snapshot: an
          // interim database snapshot can lag behind the text already streamed.
          if (!streamed || settled(row.state))
            send({ type: "snapshot", run: runView(row) });
          if (settled(row.state)) break;
          const session = row.session_id;
          if (!streamed && session && row.provider_accepted) {
            streamed = true;
            const stream = await openai().beta.agents.sessions.events.stream(
              session,
              {
                signal: AbortSignal.any([
                  signal,
                  AbortSignal.timeout(Math.max(1, deadline - Date.now())),
                ]),
              },
            );
            abort = () => stream.controller.abort();
            let finished = false;
            // Everything the user sees while the agent works comes from the
            // session's events: a new subscription replays the current turn's
            // events from its start, while the item listing holds a turn's
            // items only once it has ended. Only the final answer and the
            // agent's progress notes leave the server; reasoning and tool
            // traces do not.
            const environment = await openai()
              .beta.agents.sessions.retrieve(session)
              .then((s) =>
                openai().beta.agents.environments.retrieve(environmentId(s)),
              )
              .catch(() => undefined);
            let sandboxReady = environment?.status !== "pending";
            let doing = "Starting";
            let latest = "";
            let shown = "";
            // A reconnection during a turn first replays its events: the
            // browser keeps what it shows until the replay has caught up.
            let quiet = Boolean(row.turn_id);
            const caughtUp = setTimeout(() => {
              quiet = false;
              showProgress();
              if (answers.size) showText(true);
            }, 1500);
            const showProgress = () => {
              if (quiet) return;
              const value = {
                progress: waiting(doing, sandboxReady),
                note: latest,
              };
              const key = JSON.stringify(value);
              if (key === shown) return;
              shown = key;
              send({ type: "progress", ...value });
            };
            // The final answer as it is written, from the deltas of the
            // final-answer messages this subscription saw begin.
            const answers = new Map<string, string>();
            let textSent = 0;
            const showText = (now = false) => {
              if (quiet || !answers.size) return;
              if (!now && Date.now() - textSent < 250) return;
              textSent = Date.now();
              send({ type: "text", text: [...answers.values()].join("\n\n") });
            };
            /**
             * The listing's canonical answer once the turn has ended, and the
             * turn's status. A turn that ended between two connections sent
             * its last events to neither, so the caller wakes the workflow.
             */
            const restore = async () => {
              const { turn_id: turn } = await ownedRun(owner, id);
              if (!turn) return undefined;
              const { status } = await openai()
                .beta.agents.sessions.turns.retrieve(turn, {
                  session_id: session,
                })
                .catch(() => ({ status: "unknown" }));
              if (!terminal(status)) return undefined;
              const items = await turnItems(session, turn);
              const text = publicText(items);
              if (text) send({ type: "text", text });
              const restored = progressFromItems(items);
              if (restored.progress !== "Starting") doing = restored.progress;
              latest = restored.note || latest;
              showProgress();
              return status;
            };
            // Without events, a turn that already ended would leave the
            // connection waiting, so also watch the run settle.
            const watch = setInterval(() => {
              void ownedRun(owner, id).then(
                (current) => {
                  if (settled(current.state)) {
                    finished = true;
                    abort?.();
                  }
                },
                () => undefined,
              );
            }, 2000);
            try {
              showProgress();
              const ended = await restore();
              if (ended) {
                quiet = false;
                showProgress();
                await wake(id, `agent.session.turn.${ended}`).catch(
                  () => undefined,
                );
                finished = true;
                abort?.();
              }
              for await (const event of ended ? [] : stream) {
                if (stopped) break;
                if (SANDBOX_READY.includes(event.type)) {
                  sandboxReady = true;
                  showProgress();
                }
                if (
                  event.type === "agent.session.turn.item.added" ||
                  event.type === "agent.session.turn.item.done"
                ) {
                  const item = (event as { item?: AgentSessionItem }).item;
                  if (item) {
                    doing = activity(item) ?? doing;
                    latest = note(item) ?? latest;
                    showProgress();
                    if (
                      item.type === "message" &&
                      item.id &&
                      "phase" in item &&
                      item.phase === "final_answer"
                    ) {
                      if (event.type === "agent.session.turn.item.added")
                        answers.set(item.id, "");
                      else if (answers.has(item.id)) {
                        answers.set(item.id, publicText([item]));
                        showText(true);
                      }
                    }
                  }
                }
                if (event.type === "agent.session.turn.output_text.delta") {
                  const { item_id, delta } = event as {
                    item_id: string;
                    delta: string;
                  };
                  if (answers.has(item_id)) {
                    answers.set(item_id, answers.get(item_id) + delta);
                    showText();
                  }
                }
                if (event.type === "agent.session.turn.output_text.done")
                  showText(true);
                if (ENDED.includes(event.type)) {
                  await restore();
                  await wake(id, event.type).catch(() => undefined);
                  break;
                }
              }
            } catch (error) {
              if (!finished) throw error;
            } finally {
              clearTimeout(caughtUp);
              clearInterval(watch);
              abort?.();
              abort = undefined;
            }
            // Keep the connection until reconciliation saves files and settles the run.
            continue;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch {
        if (!stopped) send({ type: "reconnect" });
      } finally {
        abort?.();
        if (!stopped) {
          stopped = true;
          controller.close();
        }
      }
    },
    cancel() {
      stopped = true;
      abort?.();
    },
  });
}
