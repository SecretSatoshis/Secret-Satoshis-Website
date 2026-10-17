import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// The system prompt lives in the private repo and reaches OpenAI as a stored
// prompt, so the website sends only its ID and version. The prototype and the
// bench can pass a local file instead.
export type PromptSource =
  | { kind: "stored"; prompt: { id: string; version?: string }; label: string }
  | { kind: "file"; instructions: string; label: string };

export function promptSource(
  file = process.env.AGENT21_PROMPT_FILE,
): PromptSource {
  if (file) {
    const instructions = readFileSync(file, "utf8");
    const sha = createHash("sha256")
      .update(instructions)
      .digest("hex")
      .slice(0, 12);
    return { kind: "file", instructions, label: `file:${sha}` };
  }
  const id = process.env.AGENT21_PROMPT_ID;
  if (!id)
    throw new Error(
      "Set AGENT21_PROMPT_ID (or AGENT21_PROMPT_FILE for the bench)",
    );
  const version = process.env.AGENT21_PROMPT_VERSION || undefined;
  return {
    kind: "stored",
    prompt: { id, ...(version ? { version } : {}) },
    label: `${id}@${version ?? "latest"}`,
  };
}
