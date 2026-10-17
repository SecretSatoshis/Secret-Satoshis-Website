import { BlockError } from "../blocks";
import { SourceError } from "../data/http";
import {
  bitcoinLookup,
  bitcoinNetwork,
  brkSeries,
  brkSeriesSearch,
} from "./brk";
import { saveChart, saveSiteChart, siteCharts } from "./charts";
import { newsletter } from "./newsletter";
import { polymarket } from "./polymarket";
import { reportLibrary, reportLibraryColumns } from "./report-library";
import { savingsPlanTool } from "./savings";
import type { Tool, ToolContext, ToolResult } from "./types";
import { readUpload } from "./uploads";

export type { ToolContext } from "./types";

export const TOOLS: Tool[] = [
  bitcoinNetwork,
  bitcoinLookup,
  brkSeries,
  brkSeriesSearch,
  reportLibrary,
  reportLibraryColumns,
  siteCharts,
  saveSiteChart,
  saveChart,
  newsletter,
  polymarket,
  savingsPlanTool,
  readUpload,
];
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export const toolLabel = (name: string) =>
  BY_NAME.get(name)?.label ?? "Checking a data source";

// Reading the master metrics file cold takes longer than a live lookup.
const SLOW = new Set([
  "report_library",
  "report_library_columns",
  "save_chart",
  "savings_plan",
]);
const timeoutFor = (t: Tool) =>
  t.timeoutMs ?? (SLOW.has(t.name) ? 45_000 : 15_000);
/** About 3k tokens: enough for a summary and a few hundred rows. */
export const OUTPUT_CAP = 12_000;
/** For calls from a model-written program, which filters before the model reads. */
export const PROGRAM_OUTPUT_CAP = 48_000;

/** The function tools in the Responses API's strict form. */
export function functionTools(
  names?: string[],
  callers?: ("direct" | "programmatic")[],
) {
  return TOOLS.filter((t) => !names || names.includes(t.name)).map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    strict: true,
    ...(callers ? { allowed_callers: callers } : {}),
  }));
}

/** Halves the longest list until the result fits; blocks are never cut. */
export function capOutput(result: ToolResult, cap = OUTPUT_CAP) {
  let text = JSON.stringify(result);
  if (text.length <= cap) return text;
  const copy: Record<string, unknown> = { ...result };
  for (let pass = 0; pass < 12 && text.length > cap; pass++) {
    const [key, list] =
      Object.entries(copy)
        .filter(([k, v]) => k !== "blocks" && Array.isArray(v) && v.length > 2)
        .sort(
          (a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length,
        )[0] ?? [];
    if (!key) break;
    const items = list as unknown[];
    copy[key] = items.filter((_, i) => i % 2 === 0 || i === items.length - 1);
    copy.trimmed = `Some lists were thinned to fit; ask a narrower range for every row.`;
    text = JSON.stringify(copy);
  }
  if (text.length <= cap) return text;
  return JSON.stringify({
    error:
      "The result was too large to return. Ask for fewer columns or a shorter range.",
    ...(result.blocks ? { blocks: result.blocks } : {}),
  });
}

/**
 * A tool's sources block comes back as its items: the answer has one sources
 * block, which the model assembles from every tool it used.
 */
export function sourceItems(result: ToolResult): ToolResult {
  const fenced = result.blocks?.sources;
  if (!fenced) return result;
  const { sources: _, ...blocks } = result.blocks!;
  const items = (
    JSON.parse(fenced.split("\n").slice(1, -1).join("\n")) as {
      items: unknown[];
    }
  ).items;
  return { ...result, blocks, source: items.length === 1 ? items[0] : items };
}

export type ToolRun = {
  name: string;
  output: string;
  ok: boolean;
  ms: number;
  urls: string[];
  error?: string;
};

/** Runs one function call; failures come back as an error the model can act on. */
export async function runTool(
  name: string,
  rawArgs: string,
  context: ToolContext,
  /** A program reads the result, not the model, so it may take more rows. */
  cap = OUTPUT_CAP,
): Promise<ToolRun> {
  const started = Date.now();
  const before = context.log.length;
  const done = (output: string, ok: boolean, error?: string): ToolRun => ({
    name,
    output,
    ok,
    ms: Date.now() - started,
    urls: context.log.slice(before).map((f) => f.url),
    ...(error ? { error } : {}),
  });
  const t = BY_NAME.get(name);
  if (!t)
    return done(
      JSON.stringify({ error: `No tool named ${name}.` }),
      false,
      "unknown tool",
    );
  let args: unknown;
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return done(
      JSON.stringify({ error: "The arguments were not valid JSON." }),
      false,
      "bad arguments",
    );
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      t.run(args as never, context),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new SourceError(`${name} took too long`)),
          timeoutFor(t),
        );
      }),
    ]);
    return done(capOutput(sourceItems(result), cap), true);
  } catch (error) {
    const known = error instanceof SourceError || error instanceof BlockError;
    const message = known
      ? (error as Error).message
      : `The tool failed: ${error instanceof Error ? error.message : String(error)}`;
    return done(JSON.stringify({ error: message }), false, message);
  } finally {
    clearTimeout(timer);
  }
}
