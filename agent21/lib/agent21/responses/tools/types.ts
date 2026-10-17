import type { FetchLog } from "../data/http";

// What a data tool sees. The runner supplies these, so the same tools serve the
// website, the bench and the tests (where saving and uploads are fakes).
export type Artifact = { name: string; mime: string; bytes: Buffer };
export type Upload = { name: string; bytes: Buffer };
export type ToolContext = {
  log: FetchLog;
  now: Date;
  /** Keeps a file for the answer and returns its file name. */
  saveArtifact(artifact: Artifact): Promise<string>;
  /** The conversation's uploads, by name. */
  uploads: string[];
  readUpload(name: string): Promise<Upload | null>;
};

export type JsonSchema = Record<string, unknown>;
export type ToolResult = Record<string, unknown> & {
  /** Fenced answer blocks ready to paste, keyed by what they show. */
  blocks?: Record<string, string>;
};
export type Tool = {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Shown while the tool runs, from the website's existing labels. */
  label: string;
  timeoutMs?: number;
  run(args: never, context: ToolContext): Promise<ToolResult>;
};
export const tool = <A>(
  definition: Omit<Tool, "run"> & {
    run(args: A, context: ToolContext): Promise<ToolResult>;
  },
) => definition as Tool;

// Strict function schemas: every property is required and optional ones take
// null, so `undefined` below means the model passed null.
type Field = JsonSchema;
export const s = {
  str: (description: string): Field => ({ type: "string", description }),
  num: (description: string): Field => ({ type: "number", description }),
  int: (description: string): Field => ({ type: "integer", description }),
  bool: (description: string): Field => ({ type: "boolean", description }),
  oneOf: (values: readonly string[], description: string): Field => ({
    type: "string",
    enum: values,
    description,
  }),
  list: (items: Field, description: string): Field => ({
    type: "array",
    items,
    description,
  }),
  nullable(field: Field): Field {
    const type = field.type as string;
    return field.enum
      ? {
          ...field,
          type: [type, "null"],
          enum: [...(field.enum as unknown[]), null],
        }
      : { ...field, type: [type, "null"] };
  },
  object(properties: Record<string, Field>, description?: string): Field {
    return {
      type: "object",
      ...(description ? { description } : {}),
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    };
  },
};

/** Null from the model becomes undefined. */
export const opt = <T>(value: T | null | undefined) =>
  value === null ? undefined : value;

/** An ISO date in UTC. */
export const isoDay = (date: Date) => date.toISOString().slice(0, 10);
