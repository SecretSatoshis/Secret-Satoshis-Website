import { z } from "zod";

/**
 * Answer blocks, from Agent 21's response design: the agent writes each as a
 * fenced code block whose language is `a21-<type>`, holding one JSON object.
 * The website validates it here and draws it with its own components; every
 * string is drawn as text, and links must be https.
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

const text = (max: number) => z.string().trim().min(1).max(max);
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

const schemas = {
  step: z.strictObject({ text: text(120) }),
  figures: z.strictObject({
    items: z
      .array(
        z.strictObject({
          label: text(40),
          value: finite,
          format: numberFormat.optional(),
          change: finite.optional(),
          changeLabel: text(30).optional(),
          asOf: when.optional(),
          kind: z
            .enum(["observed", "calculated", "outlook", "market"])
            .optional(),
        }),
      )
      .min(1)
      .max(4),
  }),
  facts: z.strictObject({
    title: text(80).optional(),
    rows: z
      .array(
        z.strictObject({
          label: text(30),
          value: text(160),
          href: https().optional(),
          mono: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(14),
  }),
  table: z
    .strictObject({
      caption: text(80),
      columns: z
        .array(z.strictObject({ label: text(40), format: format.optional() }))
        .min(2)
        .max(6),
      rows: z
        .array(z.array(z.union([z.string().max(80), finite, z.null()])))
        .min(2)
        .max(20),
      note: text(200).optional(),
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
    }),
  ladder: z
    .strictObject({
      title: text(80),
      now: z.strictObject({ label: text(30), value: finite.positive() }),
      measure: z.enum(["odds", "distance"]),
      levels: z
        .array(
          z.strictObject({
            value: finite.positive(),
            label: text(50).optional(),
            odds: z.number().min(0).max(100).optional(),
          }),
        )
        .min(3)
        .max(24),
      market: z
        .strictObject({
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
    }),
  chart: z.strictObject({
    file: z.string().regex(/^[A-Za-z0-9_.-]{1,180}\.chart\.json$/),
    page: https("https://charts.secretsatoshis.com/").optional(),
    caption: text(120).optional(),
  }),
  sources: z.strictObject({
    items: z
      .array(
        z
          .strictObject({
            name: text(60),
            detail: text(60).optional(),
            url: https().optional(),
            asOf: when.optional(),
            published: isoDate.optional(),
          })
          .refine((item) => !(item.asOf && item.published), {
            message:
              "A source has an as-of date or a publication date, not both",
          }),
      )
      .min(1)
      .max(8),
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

/** An answer's Markdown with each block replaced by its plain-text form. */
export function plainAnswer(markdown: string, timeZone?: string) {
  let out = "";
  let at = 0;
  for (const found of extractBlocks(markdown)) {
    out += markdown.slice(at, found.start);
    const block = parseBlock(found.language, found.code);
    out += block.ok ? plainBlock(block, timeZone) : "";
    at = found.end;
  }
  return (out + markdown.slice(at)).replace(/\n{3,}/g, "\n\n").trim();
}
