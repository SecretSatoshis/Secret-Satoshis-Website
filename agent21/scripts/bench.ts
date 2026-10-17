// Times one question straight against the dashboard agent, the way the website
// starts a conversation (same agent, tools, vault and sandbox size) but without
// the website, so agent time can be told apart from website time. Optional
// overrides apply to the benchmark session only, never the saved agent.
//
//   pnpm bench "What is Bitcoin's block height?" [--model gpt-6.1-sol]
//     [--effort low|medium|high] [--tier auto|default|flex]
//     [--verbosity low|medium|high] [--size small|medium]
//     [--bare] [--prewarm] [--packages numpy,pandas] [--repeat 3] [--label x]
//     [--keep-session]
//   pnpm bench "..." --engine responses [--paths B|C|BC] [--prompt-file f]
//     [--background] [--programmatic] [--model m] [--effort e] [--tier t] [--verbosity v]
//
// --prewarm starts a sandbox from the template first, waits until it is ready
// (as if the user were still writing) and attaches it, so the timings start
// with a warm sandbox. Pre-warmed sandboxes take no size and run as medium.
// --packages runs the template's sandbox with only those Python packages (empty
// for none), to time each group's start-up cost; the template is unchanged.
//
// Writes each answer's text, full trace (reasoning summaries, progress notes,
// tool inputs and outputs, events and spans), per-call model times and token
// use to .exports/bench-*.json (git-ignored), and deletes each session unless
// --keep-session is given.
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runConversation } from "./agent-run";
import { runResponsesConversation } from "./responses-run";

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
    packages: { type: "string" },
    "keep-session": { type: "boolean", default: false },
    repeat: { type: "string", default: "1" },
    label: { type: "string", default: "baseline" },
    "time-zone": { type: "string", default: "America/New_York" },
    engine: { type: "string", default: "agents" },
    paths: { type: "string" },
    "prompt-file": { type: "string" },
    background: { type: "boolean", default: false },
    programmatic: { type: "boolean", default: false },
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
  const r =
    values.engine === "responses"
      ? await runResponsesConversation({
          turns: [question],
          label: values.label!,
          timeZone: values["time-zone"],
          model: values.model,
          effort: values.effort as never,
          tier: values.tier as never,
          verbosity: values.verbosity as never,
          paths: values.paths as never,
          promptFile: values["prompt-file"],
          background: values.background,
          programmatic: values.programmatic,
          keepSession: values["keep-session"],
          outDir: `.exports/bench-files-${values.label}`,
        })
      : await runConversation({
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
          packages:
            values.packages === undefined
              ? undefined
              : values.packages.split(",").filter(Boolean),
          keepSession: values["keep-session"],
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
