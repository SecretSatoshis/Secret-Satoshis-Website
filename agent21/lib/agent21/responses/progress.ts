import type { ResponseOutputItem } from "openai/resources/responses/responses";
import { toolLabel } from "./tools";

/** The website's activity labels for the Responses engine's items (see ../progress.ts). */
export function progressFor(item: ResponseOutputItem): string | undefined {
  switch (item.type) {
    case "reasoning":
      return "Thinking";
    case "function_call":
      return toolLabel(item.name);
    case "web_search_call":
      return "Searching the web";
    case "shell_call":
      return "Running analysis";
    case "message":
      return "phase" in item && item.phase === "commentary"
        ? "Thinking"
        : "Writing the answer";
    default:
      return undefined;
  }
}
