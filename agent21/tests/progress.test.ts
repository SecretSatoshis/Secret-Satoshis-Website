import test from "node:test";
import assert from "node:assert/strict";
import type { AgentSessionItem } from "openai/resources/beta/agents/agents";
import { noteText, progressFromItems } from "../lib/agent21/progress";

const item = (value: object) => value as unknown as AgentSessionItem;
const commentary = (text: string) =>
  item({
    type: "message",
    role: "assistant",
    phase: "commentary",
    content: [{ type: "output_text", text }],
  });

test("progress names the activity and keeps the latest note", () => {
  assert.deepEqual(progressFromItems([]), { progress: "Starting", note: "" });
  const items = [
    item({ type: "message", role: "user", content: [] }),
    item({ type: "reasoning", summary: [{ text: "**Internal**" }] }),
    commentary("I’ll check the transaction’s on-chain details."),
    item({ type: "command_execution", command: "python - <<EOF" }),
  ];
  assert.deepEqual(progressFromItems(items), {
    progress: "Running analysis",
    note: "I’ll check the transaction’s on-chain details.",
  });
  assert.equal(
    progressFromItems([
      item({ type: "mcp_call", server_label: "github", name: "search_code" }),
    ]).progress,
    "Reading Secret Satoshis code",
  );
  assert.equal(
    progressFromItems([item({ type: "web_search_call" })]).progress,
    "Searching the web",
  );
});

test("until the sandbox is ready, thinking is shown as starting a workspace", () => {
  const thinking = [item({ type: "reasoning", summary: [] })];
  assert.equal(
    progressFromItems(thinking, false).progress,
    "Starting a workspace",
  );
  assert.equal(progressFromItems(thinking, true).progress, "Thinking");
});

test("notes are one line of plain text without reasoning or code", () => {
  assert.equal(
    noteText("I’ll use **BRK**\n\nand `download_public` [docs](https://x.y)."),
    "I’ll use BRK and download_public docs.",
  );
  assert.equal(noteText("Look:\n```python\nprint(1)\n```\ndone"), "Look: done");
  const long = noteText("word ".repeat(100));
  assert(long.length <= 241 && long.endsWith("…"));
});
