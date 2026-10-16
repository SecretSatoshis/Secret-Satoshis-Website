import { z } from "zod";

/**
 * Answer blocks, from Agent 21's response design: the agent writes each as a
 * fenced code block whose language is `a21-<type>`, holding one JSON object.
 * The website validates it here and draws it with its own components; every
 * string is drawn as text, and links must be https.
 *
 * Only safety and structure refuse a block: links, chart files, numbers, odds
 * and their market, and table rows that do not match their columns. Everything
 * else is fitted rather than refused: long text is shortened at a word, extra
 * items are dropped, unknown fields, formats and malformed optional dates are
 * ignored, and fact values and step lines are tidied to the visual standards.
 */
export const BLOCK_TYPES = [
  "step",
  "figures",
  "facts",
  "table",
  "ladder",
  "chart",
  "sources",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const BLOCK_LANGUAGES = BLOCK_TYPES.map((type) => `a21-${type}`);
const MAX_BLOCK_CHARS = 20_000;

/** Text cut to its space at a word, with an ellipsis. */
export function shorten(value: string, max: number) {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((value) => shorten(value, max));
const https = (prefix = "https://") =>
  z
    .string()
    .max(500)
    .refine((value) => {
      if (!value.startsWith(prefix)) return false;
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    }, `Must be a link under ${prefix}`);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
const isoTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/)
  .refine((value) => !Number.isNaN(Date.parse(value)));
const when = z.union([isoDate, isoTime]);
const finite = z.number().finite();
/** At least one item; the space shows the first `max`. */
const list = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .min(1)
    .transform((items) => items.slice(0, max));

export const FORMATS = [
  "text",
  "usd",
  "usd2",
  "usd_compact",
  "btc",
  "sats",
  "number",
  "percent",
  "change",
  "pp",
  "date",
] as const;
export type Format = (typeof FORMATS)[number];
const format = z.enum(FORMATS);
const numberFormat = format.exclude(["text", "date"]);
// An unknown format, kind or malformed date only loses its styling.
const optional = <T extends z.ZodType>(schema: T) =>
  schema.optional().catch(undefined);

const ISO_TIME_IN_TEXT =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z\b/g;
const ISO_DATE_IN_TEXT = /\b\d{4}-\d{2}-\d{2}\b/g;
const PADDED_BTC = /\b(\d+)\.(\d*?)0+(?=\s*BTC\b)/g;
/** A written value in the visual standards: readable dates, BTC without trailing zeros. */
export function tidyValue(value: string) {
  return value
    .replace(ISO_TIME_IN_TEXT, (iso) =>
      Number.isNaN(Date.parse(iso)) ? iso : formatTime(iso, "UTC"),
    )
    .replace(ISO_DATE_IN_TEXT, (iso) =>
      Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? iso : formatDate(iso),
    )
    .replace(PADDED_BTC, (_, whole: string, fraction: string) =>
      fraction ? `${whole}.${fraction}` : whole,
    );
}
/** A step line starting with what was checked: "I checked X" becomes "Checked X". */
export function tidyStep(value: string) {
  return value.replace(
    /^(?:I|We)(?:'ve|’ve| have)?\s+(\p{L})/u,
    (_, first: string) => first.toUpperCase(),
  );
}

const TABLE_COLUMNS = 6;
const TABLE_ROWS = 20;
const LADDER_LEVELS = 24;

const schemas = {
  step: z.object({ text: text(120).transform(tidyStep) }),
  figures: z.object({
    items: list(
      z.object({
        label: text(40),
        value: finite,
        format: optional(numberFormat),
        change: optional(finite),
        changeLabel: optional(text(30)),
        asOf: optional(when),
        kind: optional(z.enum(["observed", "calculated", "outlook", "market"])),
      }),
      4,
    ),
  }),
  facts: z.object({
    title: optional(text(80)),
    rows: list(
      z
        .object({
          label: text(30),
          value: z.string().trim().min(1),
          href: https().optional(),
          mono: z.boolean().optional().catch(undefined),
        })
        .transform((row) => ({
          ...row,
          // Hashes and addresses are drawn exactly as written.
          value: shorten(row.mono ? row.value : tidyValue(row.value), 160),
        })),
      14,
    ),
  }),
  table: z
    .object({
      caption: text(80),
      columns: z
        .array(z.object({ label: text(40), format: optional(format) }))
        .min(1),
      rows: z
        .array(
          z.array(
            z.union([
              z.string().transform((value) => shorten(tidyValue(value), 80)),
              finite,
              z.null(),
            ]),
          ),
        )
        .min(1),
      note: optional(text(200)),
    })
    .superRefine((table, ctx) => {
      table.rows.forEach((row, i) => {
        if (row.length !== table.columns.length)
          ctx.addIssue({
            code: "custom",
            path: ["rows", i],
            message: `Row ${i + 1} has ${row.length} cells for ${table.columns.length} columns`,
          });
      });
    })
    .transform((table) => {
      const more = table.rows.length > TABLE_ROWS;
      const note = [
        table.note,
        more ? `First ${TABLE_ROWS} of ${table.rows.length} rows.` : undefined,
      ]
        .filter(Boolean)
        .join(" ");
      return {
        ...table,
        columns: table.columns.slice(0, TABLE_COLUMNS),
        rows: table.rows
          .slice(0, TABLE_ROWS)
          .map((row) => row.slice(0, TABLE_COLUMNS)),
        note: note ? shorten(note, 240) : undefined,
      };
    }),
  ladder: z
    .object({
      title: text(80),
      now: z.object({ label: text(30), value: finite.positive() }),
      measure: z.enum(["odds", "distance"]),
      levels: z
        .array(
          z.object({
            value: finite.positive(),
            label: optional(text(50)),
            odds: z.number().min(0).max(100).optional(),
          }),
        )
        .min(1),
      market: z
        .object({
          name: text(120),
          url: https("https://polymarket.com/"),
          volume: finite.nonnegative(),
          liquidity: finite.nonnegative(),
        })
        .optional(),
    })
    .superRefine((ladder, ctx) => {
      const odds = ladder.measure === "odds";
      if (odds && !ladder.market)
        ctx.addIssue({
          code: "custom",
          path: ["market"],
          message: "Odds need the market, its volume and liquidity",
        });
      ladder.levels.forEach((level, i) => {
        if (odds !== (level.odds !== undefined))
          ctx.addIssue({
            code: "custom",
            path: ["levels", i, "odds"],
            message: odds
              ? "Every level needs its odds"
              : "Distance levels have no odds",
          });
      });
    })
    .transform((ladder) => ({
      ...ladder,
      // The levels nearest the current value, when there are too many.
      levels:
        ladder.levels.length > LADDER_LEVELS
          ? [...ladder.levels]
              .sort(
                (a, b) =>
                  Math.abs(a.value - ladder.now.value) -
                  Math.abs(b.value - ladder.now.value),
              )
              .slice(0, LADDER_LEVELS)
          : ladder.levels,
    })),
  chart: z.object({
    file: z.string().regex(/^[A-Za-z0-9_.-]{1,180}\.chart\.json$/),
    page: https("https://charts.secretsatoshis.com/").optional(),
    caption: optional(text(120)),
  }),
  sources: z.object({
    items: list(
      z
        .object({
          name: text(60),
          detail: optional(z.string().transform(tidyValue).pipe(text(60))),
          url: https().optional(),
          asOf: optional(when),
          published: optional(isoDate),
        })
        // A source shows one date: its as-of date when it has both.
        .transform((item) =>
          item.asOf && item.published
            ? { ...item, published: undefined }
            : item,
        ),
      8,
    ),
  }),
} satisfies Record<BlockType, z.ZodType>;

export type Blocks = { [T in BlockType]: z.infer<(typeof schemas)[T]> };
export type Block = {
  [T in BlockType]: { type: T; data: Blocks[T] };
}[BlockType];
export type ParsedBlock =
  | ({ ok: true } & Block)
  | { ok: false; type: BlockType | null; reason: string };

const isType = (value: string): value is BlockType =>
  (BLOCK_TYPES as readonly string[]).includes(value);

/** Validates one fenced block by its language (`a21-<type>`) and JSON body. */
export function parseBlock(language: string, code: string): ParsedBlock {
  const name = language.startsWith("a21-") ? language.slice(4) : "";
  if (!isType(name)) return { ok: false, type: null, reason: "unknown block" };
  if (code.length > MAX_BLOCK_CHARS)
    return { ok: false, type: name, reason: "block too large" };
  let value: unknown;
  try {
    value = JSON.parse(code);
  } catch {
    return { ok: false, type: name, reason: "invalid JSON" };
  }
  const result = schemas[name].safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      type: name,
      reason: `${issue.path.join(".") || name}: ${issue.message}`,
    };
  }
  return { ok: true, type: name, data: result.data } as ParsedBlock;
}

const FENCE = /^```(a21-[a-z]+)[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;

/** Every complete answer block in an answer's Markdown, in order. */
export function extractBlocks(markdown: string) {
  return [...markdown.matchAll(FENCE)].map((match) => ({
    language: match[1],
    code: match[2],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** Chart files an answer places with chart blocks, which leave its file list. */
export function placedCharts(markdown: string) {
  const names = new Set<string>();
  for (const { language, code } of extractBlocks(markdown)) {
    if (language !== "a21-chart") continue;
    const block = parseBlock(language, code);
    if (block.ok && block.type === "chart") names.add(block.data.file);
  }
  return names;
}

// Formatting: the same kind of number always looks the same (the design's
// "Visual standards"). Signs use the minus character.
const MINUS = "−";
const signed = (n: number, body: (abs: number) => string, plus = false) =>
  n < 0 ? `${MINUS}${body(-n)}` : `${plus && n > 0 ? "+" : ""}${body(n)}`;
const grouped = (n: number, digits = 0) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const trimmed = (n: number, max: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: max });
const percentBody = (abs: number) =>
  `${abs >= 10 ? grouped(abs) : trimmed(Number(abs.toFixed(1)), 1)}%`;
const compact = (abs: number) => {
  for (const [size, unit] of [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ] as const)
    if (abs >= size)
      return `${trimmed(Number((abs / size).toFixed(1)), 1)}${unit}`;
  return trimmed(abs, 2);
};

/** One value in a block's format. Text passes through; dates are UTC days. */
export function formatValue(
  value: string | number | null,
  kind: Format = "text",
): string {
  if (value === null) return "—";
  if (typeof value === "string")
    return kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? formatDate(value)
      : value;
  switch (kind) {
    case "usd":
      return signed(value, (a) => `$${a >= 1000 ? grouped(a) : grouped(a, 2)}`);
    case "usd2":
      return signed(value, (a) => `$${grouped(a, 2)}`);
    case "usd_compact":
      return signed(value, (a) =>
        a >= 1000 ? `$${compact(a)}` : `$${grouped(a, 2)}`,
      );
    case "btc":
      return signed(value, (a) => `${trimmed(a, 8)} BTC`);
    case "sats":
      return signed(value, (a) => `${grouped(Math.round(a))} sats`);
    case "percent":
      return signed(value * 100, percentBody);
    case "change":
      return signed(value * 100, percentBody, true);
    case "pp":
      return signed(
        value,
        (a) => `${trimmed(Number(a.toFixed(1)), 1)} pp`,
        true,
      );
    default:
      return signed(value, (a) => trimmed(a, a >= 100 ? 0 : 2));
  }
}

/** Market odds keep a decimal, as the market quotes them: 59.5%, 2.2%. */
export const formatOdds = (percent: number) =>
  `${percent.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;

/** Up, down or flat, for coloring a change. */
export const direction = (n: number | undefined) =>
  n === undefined || n === 0 ? "flat" : n > 0 ? "up" : "down";

/** A UTC calendar day: "Oct 14, 2026". */
export function formatDate(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A time in the reader's own zone: "Oct 15, 2026, 3:21 PM EDT". */
export function formatTime(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  });
}

/** A date or a time, each in its own convention. */
export const formatWhen = (iso: string, timeZone?: string) =>
  iso.includes("T") ? formatTime(iso, timeZone) : formatDate(iso);

/** The plain-text form of a block, for Copy and screen readers. */
export function plainBlock(block: Block, timeZone?: string): string {
  switch (block.type) {
    case "step":
      return block.data.text;
    case "figures":
      return block.data.items
        .map(
          (item) =>
            `${item.label}: ${formatValue(item.value, item.format ?? "number")}${
              item.change === undefined
                ? ""
                : ` (${formatValue(item.change, "change")}${item.changeLabel ? ` ${item.changeLabel}` : ""})`
            }`,
        )
        .join("\n");
    case "facts":
      return [
        ...(block.data.title ? [block.data.title] : []),
        ...block.data.rows.map((row) => `${row.label}: ${row.value}`),
      ].join("\n");
    case "table": {
      const { caption, columns, rows, note } = block.data;
      return [
        caption,
        columns.map((c) => c.label).join(" | "),
        ...rows.map((row) =>
          row
            .map((cell, i) => formatValue(cell, columns[i].format))
            .join(" | "),
        ),
        ...(note ? [note] : []),
      ].join("\n");
    }
    case "ladder": {
      const { title, now, levels, measure } = block.data;
      const sorted = [...levels].sort((a, b) => b.value - a.value);
      return [
        title,
        ...sorted.map(
          (level) =>
            `${formatValue(level.value, "usd")}${level.label ? ` ${level.label}` : ""}: ${
              measure === "odds"
                ? `${formatOdds(level.odds ?? 0)} (market-implied)`
                : formatValue(level.value / now.value - 1, "change")
            }`,
        ),
        `${now.label}: ${formatValue(now.value, "usd")}`,
      ].join("\n");
    }
    case "chart":
      return `[Chart: ${block.data.caption ?? block.data.file.replace(/\.chart\.json$/, "").replaceAll("_", " ")}]`;
    case "sources":
      return `Sources: ${block.data.items
        .map((item) =>
          [
            item.name,
            item.detail,
            item.asOf && formatWhen(item.asOf, timeZone),
            item.published && `published ${formatDate(item.published)}`,
            item.url,
          ]
            .filter(Boolean)
            .join(", "),
        )
        .join("; ")}`;
  }
}

// Code fences, including one still streaming in, and inline code stay as written.
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
const MONTH_PERIOD =
  /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.(?= \d)/g;

/** Writes months as the blocks do ("Oct 14", "Sep 16"), not "Oct. 14" or
 * "Sept. 16", in an answer's text; code and blocks are left alone. */
export function tidyProse(markdown: string) {
  let out = "";
  let at = 0;
  for (const match of markdown.matchAll(CODE)) {
    out += tidyMonths(markdown.slice(at, match.index)) + match[0];
    at = match.index + match[0].length;
  }
  return out + tidyMonths(markdown.slice(at));
}
const tidyMonths = (text: string) =>
  text.replace(MONTH_PERIOD, (_, month: string) =>
    month === "Sept" ? "Sep" : month,
  );

/** An answer's Markdown with each block replaced by its plain-text form. */
export function plainAnswer(markdown: string, timeZone?: string) {
  let out = "";
  let at = 0;
  for (const found of extractBlocks(markdown)) {
    out += tidyProse(markdown.slice(at, found.start));
    const block = parseBlock(found.language, found.code);
    out += block.ok ? plainBlock(block, timeZone) : "";
    at = found.end;
  }
  return (out + tidyProse(markdown.slice(at)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
