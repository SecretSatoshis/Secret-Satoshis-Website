import { ownedRun } from "./db";
import { runView } from "./service";
import { terminal } from "./types";
import { openai, publicText, turnItems } from "./openai";
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
      try {
        const deadline = Date.now() + 45_000;
        let streamed = false;
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
            let refreshed = 0;
            let finished = false;
            const restore = async () => {
              const current = await ownedRun(owner, id);
              if (!current.turn_id) return;
              send({
                type: "text",
                text: publicText(await turnItems(session, current.turn_id)),
              });
              refreshed = Date.now();
            };
            // The event stream is live-only: a turn that ended before this
            // subscription emits nothing more, so also watch the run settle.
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
              // Canonical items prevent snapshot/delta overlap from repeating text after reconnect.
              // Only assistant final-answer content leaves the server; reasoning and tool traces do not.
              await restore();
              for await (const event of stream) {
                if (stopped) break;
                if (
                  (event.type === "agent.session.turn.output_text.delta" &&
                    Date.now() - refreshed > 1000) ||
                  event.type === "agent.session.turn.output_text.done"
                )
                  await restore();
                if (
                  [
                    "agent.session.turn.completed",
                    "agent.session.turn.failed",
                    "agent.session.turn.cancelled",
                  ].includes(event.type)
                ) {
                  await restore();
                  break;
                }
              }
            } catch (error) {
              if (!finished) throw error;
            } finally {
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
