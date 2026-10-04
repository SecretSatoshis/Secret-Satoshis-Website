export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  files?: FileView[];
  feedback?: "positive" | "negative" | null;
};
export type FileView = {
  id: string;
  name: string;
  type: string;
  bytes: number;
  kind: "upload" | "source" | "artifact";
};
export type Conversation = {
  id: string;
  title: string;
  archived: boolean;
  updatedAt: string;
};
export type RunState =
  | "queued"
  | "submitting"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";
export type RunView = {
  id: string;
  state: RunState;
  text: string;
  progress: string;
  error: string | null;
  files: FileView[];
};
// The public homepage; the app itself is served from its own subdomain.
export const SITE = "https://secretsatoshis.com";
export const terminal = (state: string) =>
  ["completed", "failed", "cancelled"].includes(state);
