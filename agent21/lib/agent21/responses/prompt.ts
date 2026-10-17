import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { db } from "../db";
import { AppError } from "../errors";

// The system prompt lives in the private repo. `pnpm ops prompt publish` stores
// it in the database as a numbered version (with the voice guide inlined), and
// the website reads the active one, so the text never enters this public repo.
// The bench and evals can pass a local file instead. An OpenAI stored prompt
// (ID and version) is accepted too.
export type PromptSource =
  | { kind: "stored"; prompt: { id: string; version?: string }; label: string }
  | { kind: "file"; instructions: string; label: string }
  | { kind: "db"; instructions: string; label: string; version: number };

export const PRIVATE_MARKER = "AGENT21_PRIVATE_CONTROL";

/** A local prompt file, or an OpenAI stored prompt: for the bench and evals. */
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

let cached: { at: number; source: PromptSource } | undefined;
const CACHE_MS = 60_000;

/** The website's prompt: the active published version, cached for a minute. */
export async function activePrompt(): Promise<PromptSource> {
  if (process.env.AGENT21_PROMPT_FILE) return promptSource();
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.source;
  const row = await db()
    .selectFrom("agent21_prompts")
    .select(["version", "text", "sha256"])
    .where("active", "=", true)
    .executeTakeFirst();
  if (!row)
    throw new AppError(503, "Agent 21 is not configured yet. Try again later.");
  const source: PromptSource = {
    kind: "db",
    instructions: row.text,
    version: row.version,
    label: `v${row.version}:${row.sha256.slice(0, 12)}`,
  };
  cached = { at: Date.now(), source };
  return source;
}

/** Test-only: forget the cached prompt. */
export function clearPromptCache() {
  cached = undefined;
}

/**
 * The text published for a prompt file: the instructions with the voice guide
 * appended under its own heading, so the guide keeps a single source.
 */
export function publishedText(instructions: string, voiceGuide?: string) {
  if (!instructions.startsWith(PRIVATE_MARKER))
    throw new Error(`The prompt must start with ${PRIVATE_MARKER}`);
  if (!voiceGuide) return instructions.trimEnd() + "\n";
  const guide = voiceGuide.replace(/^#[^\n]*\n/, "").trim();
  return `${instructions.trimEnd()}\n\n## Voice\n\nWrite every answer in this voice.\n\n${guide}\n`;
}

/** Stores a new version and makes it the active one. */
export async function publishPrompt(text: string, source: string) {
  const sha256 = createHash("sha256").update(text).digest("hex");
  return db()
    .transaction()
    .execute(async (trx) => {
      const same = await trx
        .selectFrom("agent21_prompts")
        .select("version")
        .where("sha256", "=", sha256)
        .orderBy("version", "desc")
        .executeTakeFirst();
      await trx
        .updateTable("agent21_prompts")
        .set({ active: false })
        .where("active", "=", true)
        .execute();
      if (same) {
        await trx
          .updateTable("agent21_prompts")
          .set({ active: true })
          .where("version", "=", same.version)
          .execute();
        return { version: same.version, sha256, reused: true };
      }
      const row = await trx
        .insertInto("agent21_prompts")
        .values({ sha256, text, source, active: true })
        .returning("version")
        .executeTakeFirstOrThrow();
      return { version: row.version, sha256, reused: false };
    });
}

/** Makes an earlier version active again (a rollback). */
export async function activatePrompt(version: number) {
  await db()
    .transaction()
    .execute(async (trx) => {
      const exists = await trx
        .selectFrom("agent21_prompts")
        .select("version")
        .where("version", "=", version)
        .executeTakeFirst();
      if (!exists) throw new Error(`No prompt version ${version}`);
      await trx
        .updateTable("agent21_prompts")
        .set({ active: false })
        .where("active", "=", true)
        .execute();
      await trx
        .updateTable("agent21_prompts")
        .set({ active: true })
        .where("version", "=", version)
        .execute();
    });
}
