import type { AgentSessionItem } from "openai/resources/beta/agents/agents";

/**
 * What the user sees while an answer is in progress: what the agent is doing
 * now, and its latest progress note. The notes are the agent's commentary
 * messages, written for the user; reasoning summaries and tool input and
 * output never leave the server.
 */
export type Progress = { progress: string; note: string };

const NOTE_CHARS = 240;
/** One line of plain text, cut at a word near the limit. */
export function noteText(text: string) {
  const line = text
    .replace(/```[\s\S]*?```/g, " ")
    // Markdown emphasis, code marks and heading or quote markers, not the
    // underscores inside names such as download_public.
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\n)\s*[#>]+\s*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (line.length <= NOTE_CHARS) return line;
  const cut = line.slice(0, NOTE_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), NOTE_CHARS - 40))}…`;
}
const messageText = (item: AgentSessionItem) =>
  item.type === "message" && "content" in item
    ? item.content
        .map((part) =>
          part.type === "output_text" && "text" in part ? part.text : "",
        )
        .join(" ")
    : "";
const isCommentary = (item: AgentSessionItem) =>
  item.type === "message" &&
  item.role === "assistant" &&
  "phase" in item &&
  item.phase === "commentary";

/** The activity an item shows, or undefined for one that changes nothing. */
export function activity(item: AgentSessionItem): string | undefined {
  switch (item.type) {
    case "reasoning":
      return "Thinking";
    case "command_execution":
      return "Running analysis";
    case "web_search_call":
      return "Searching the web";
    case "mcp_call":
      return /github/i.test(item.server_label)
        ? "Reading Secret Satoshis code"
        : "Checking a data source";
    case "message":
      if (item.role !== "assistant") return undefined;
      return "phase" in item && item.phase === "final_answer"
        ? "Writing the answer"
        : "Thinking";
    default:
      return undefined;
  }
}
/** The latest commentary as a note, or undefined when the item is not one. */
export function note(item: AgentSessionItem) {
  return isCommentary(item)
    ? noteText(messageText(item)) || undefined
    : undefined;
}
/**
 * The progress a turn's items show. Until the sandbox is ready the agent can
 * only think, so the wait is named for what it is.
 */
export function progressFromItems(
  items: AgentSessionItem[],
  sandboxReady = true,
): Progress {
  let current = "Starting";
  let latest = "";
  for (const item of items) {
    current = activity(item) ?? current;
    latest = note(item) ?? latest;
  }
  return { progress: waiting(current, sandboxReady), note: latest };
}
export const waiting = (current: string, sandboxReady: boolean) =>
  !sandboxReady && ["Starting", "Thinking"].includes(current)
    ? "Starting a workspace"
    : current;
