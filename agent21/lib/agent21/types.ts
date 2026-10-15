export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  files?: FileView[];
  feedback?: "positive" | "negative" | null;
};
export type FileView = {
  id: string;
  name: string;
  type: string;
  bytes: number;
  kind: "upload" | "artifact";
};
export type Conversation = {
  id: string;
  title: string;
  archived: boolean;
  updatedAt: string;
};
export type RunState =
  | "queued"
  | "submitting"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";
export type RunView = {
  id: string;
  state: RunState;
  text: string;
  /** What the agent is doing now, such as "Running analysis". */
  progress: string;
  /** The agent's latest progress note, written for the user. */
  note: string;
  error: string | null;
  files: FileView[];
  /** When the message was sent, for the elapsed time while it works. */
  startedAt: string;
};
// The public homepage; the app itself is served from its own subdomain.
export const SITE = "https://secretsatoshis.com";
export const terminal = (state: string) =>
  ["completed", "failed", "cancelled"].includes(state);
/** Chart Library payloads the conversation draws as interactive charts. */
export const isChartFile = (name: string) => name.endsWith(".chart.json");
/**
 * The conversation file an answer means when it links a sandbox path:
 * `/workspace/outputs/<name>` for deliverables, `/workspace/inputs/<file id>/<name>`
 * for uploads. Without an ID a name can repeat (the same upload twice), so the
 * latest file wins.
 */
export function sandboxFile(href: string | undefined, files: FileView[]) {
  const match = href?.match(
    /^(?:sandbox:)?\/?workspace\/(?:outputs|inputs)\/(?:([0-9a-f-]{36})\/)?([^/?#]+)$/i,
  );
  if (!match) return undefined;
  const [, id, path] = match;
  let name = path;
  try {
    name = decodeURIComponent(path);
  } catch {}
  return files.findLast(
    (file) => file.name === name && (!id || file.id === id),
  );
}
