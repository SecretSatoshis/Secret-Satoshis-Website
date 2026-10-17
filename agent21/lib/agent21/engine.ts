// Which engine answers: the Responses engine (lib/agent21/responses), or the
// dormant Agents engine kept as a fallback (AGENT21_ENGINE=agents). A run that
// already reached an Agents session finishes there, so switching engines
// never strands an answer in progress.
export type Engine = "agents" | "responses";

export const engine = (): Engine =>
  process.env.AGENT21_ENGINE === "agents" ? "agents" : "responses";

/** The engine a run belongs to: the Agents engine once it has a session. */
export const runEngine = (run: {
  session_id: string | null;
  submission: unknown;
  session_creation_started_at: Date | string | null;
}): Engine =>
  run.session_id || run.submission || run.session_creation_started_at
    ? "agents"
    : engine();
