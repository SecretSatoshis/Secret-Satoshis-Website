// Times one question straight against the dashboard agent, the way the website
// starts a conversation (same agent, tools, vault and sandbox size) but without
// the website, so agent time can be told apart from website time. Optional
// overrides apply to the benchmark session only, never the saved agent.
//
//   pnpm bench "What is Bitcoin's block height?" [--model gpt-6.1-sol]
//     [--effort low|medium|high] [--tier auto|default|flex]
//     [--verbosity low|medium|high] [--size small|medium]
//     [--bare] [--prewarm] [--repeat 3] [--label x]
//
// --prewarm starts a sandbox from the template first, waits until it is ready
// (as if the user were still writing) and attaches it, so the timings start
// with a warm sandbox. Pre-warmed sandboxes take no size and run as medium.
//
// Writes each answer's text, trace, event timeline, per-call model times and
// token use to .exports/bench-*.json (git-ignored) and deletes each session.
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runConversation } from "./agent-run";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: "string" },
    effort: { type: "string" },
    tier: { type: "string" },
    verbosity: { type: "string" },
    size: { type: "string" },
    bare: { type: "boolean", default: false },
    prewarm: { type: "boolean", default: false },
    repeat: { type: "string", default: "1" },
    label: { type: "string", default: "baseline" },
    "time-zone": { type: "string", default: "America/New_York" },
  },
});
const question = positionals.join(" ").trim();
if (!question) {
  console.error(
    'Usage: pnpm bench "<question>" [--model m] [--effort e] [--tier t] [--verbosity v] [--repeat n] [--label x]',
  );
  process.exit(1);
}

const results = [];
for (let i = 1; i <= Number(values.repeat); i++) {
  const r = await runConversation({
    turns: [question],
    label: values.label!,
    timeZone: values["time-zone"],
    model: values.model,
    effort: values.effort,
    tier: values.tier,
    verbosity: values.verbosity,
    size: values.size,
    bare: values.bare,
    prewarm: values.prewarm,
  });
  results.push({ run: i, ...r });
  const a = r.answers[0];
  console.log(
    `[${r.label} #${i}] ${a.ended ?? "no end"} · ${r.prewarmReadySeconds !== null ? `pre-warmed in ${r.prewarmReadySeconds}s · ` : ""}total ${a.totalSeconds}s · session ${a.firstEventSeconds}s · sandbox ready ${a.environmentReadySeconds}s · first answer text ${a.firstAnswerTextSeconds}s · ` +
      `model ${a.modelSeconds}s in ${a.modelCalls} calls (first ${a.firstModelCallSeconds}s) · tools ${a.toolSeconds}s in ${a.toolCalls} (${a.failedTools} failed) · ` +
      `tokens in ${a.tokens.input} (cached ${a.tokens.cached}) out ${a.tokens.output} (reasoning ${a.tokens.reasoning})`,
  );
}
mkdirSync(".exports", { recursive: true });
const file = `.exports/bench-${values.label}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ question, results }, null, 2), {
  mode: 0o600,
});
console.log(`Saved ${file}`);
