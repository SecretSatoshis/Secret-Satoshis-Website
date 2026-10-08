import type { ColumnType, Generated, Insertable, Selectable } from "kysely";
import type { FileView, RunState } from "./types";

/** Row types for the Agent 21 tables after every migration in ../../migrations. */
type Timestamp = ColumnType<Date, Date | string, Date | string>;
type DefaultTimestamp = ColumnType<
  Date,
  Date | string | undefined,
  Date | string
>;
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;
// pg returns int8 and numeric as strings; callers convert with Number().
type Numeric = ColumnType<string | number, number | string, number | string>;
// JSON is written as text: pg would send a JS array as a Postgres array.
type DefaultJson<T> = ColumnType<T, string | undefined, string>;
type NullableJson<T> = ColumnType<T | null, string | null, string | null>;

export type RunInput = {
  text: string;
  files: FileView[];
  /** The browser's IANA time zone, such as America/New_York. */
  timeZone?: string;
};
export type RunDisplay = {
  text?: string;
  progress?: string;
  error?: string | null;
  files?: FileView[];
};
export type SessionSubmission = {
  kind: "session";
  body: Record<string, unknown>;
};
export type MessageSubmission = {
  kind: "message";
  "Idempotency-Key": string;
  events: unknown[];
};
export type ToolResult =
  { success: true; output: string } | { success: false; error: string };

export interface UsersTable {
  id: string;
  beta_enabled: Generated<boolean>;
  deleting: Generated<boolean>;
  created_at: DefaultTimestamp;
}
export interface ConversationsTable {
  id: string;
  owner_id: string;
  session_id: string | null;
  agent_id: string;
  template_id: string;
  runtime_version: string;
  deleting: Generated<boolean>;
  title: Generated<string>;
  archived: Generated<boolean>;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}
export interface SessionsTable {
  id: string;
  conversation_id: string;
  environment_id: string | null;
  created_at: DefaultTimestamp;
}
export interface RunsTable {
  id: string;
  conversation_id: string;
  owner_id: string;
  request_id: string;
  state: Generated<RunState>;
  input: NullableJson<RunInput>;
  display: DefaultJson<RunDisplay>;
  session_id: string | null;
  turn_id: string | null;
  workflow_id: string | null;
  cancel_requested: Generated<boolean>;
  user_message_id: string | null;
  assistant_message_id: string | null;
  provider_accepted: Generated<boolean>;
  created_at: DefaultTimestamp;
  finished_at: NullableTimestamp;
  worker_lease_id: string | null;
  worker_lease_until: NullableTimestamp;
  submission: NullableJson<SessionSubmission | MessageSubmission>;
  prior_turn_ids: NullableJson<string[]>;
  session_creation_started_at: NullableTimestamp;
  last_diagnostic: NullableJson<Record<string, unknown>>;
  last_error_at: NullableTimestamp;
}
export interface FilesTable {
  id: string;
  owner_id: string;
  conversation_id: string;
  run_id: string | null;
  kind: FileView["kind"];
  state: Generated<"pending" | "ready" | "rejected" | "deleting">;
  name: string;
  content_type: string;
  bytes: Numeric;
  blob_path: string;
  sha256: string | null;
  openai_file_id: string | null;
  artifact_key: string | null;
  upload_token_expires_at: NullableTimestamp;
  created_at: DefaultTimestamp;
}
export interface EventsTable {
  id: string;
  created_at: DefaultTimestamp;
}
export interface DeletionsTable {
  id: string;
  owner_id: string;
  conversation_id: string | null;
  state: Generated<string>;
  workflow_id: string | null;
  created_at: DefaultTimestamp;
}
export interface FileDeletionsTable {
  id: string;
  owner_id: string;
  conversation_id: string;
  file_id: string;
  state: Generated<string>;
  workflow_id: string | null;
  created_at: DefaultTimestamp;
}
export interface MessagesTable {
  id: string;
  conversation_id: string;
  owner_id: string;
  external_id: string;
  role: "user" | "assistant";
  text: string;
  files: DefaultJson<FileView[]>;
  feedback: "positive" | "negative" | null;
  created_at: Timestamp;
}
export interface SessionFilesTable {
  session_id: string;
  file_id: string;
}
export interface Database {
  agent21_users: UsersTable;
  agent21_conversations: ConversationsTable;
  agent21_sessions: SessionsTable;
  agent21_runs: RunsTable;
  agent21_files: FilesTable;
  agent21_events: EventsTable;
  agent21_deletions: DeletionsTable;
  agent21_file_deletions: FileDeletionsTable;
  agent21_messages: MessagesTable;
  agent21_session_files: SessionFilesTable;
}
export type Run = Selectable<RunsTable>;
export type FileRow = Selectable<FilesTable>;
export type NewFile = Insertable<FilesTable>;
