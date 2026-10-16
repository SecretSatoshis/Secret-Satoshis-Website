"use client";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";
import { uploadPresigned } from "@vercel/blob/client";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  ThreadPrimitive,
  ThreadListPrimitive,
  ThreadListItemPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
  AttachmentPrimitive,
  MessageNotSentError,
  useAuiState,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import type {
  AttachmentAdapter,
  ExternalStoreThreadListAdapter,
  FeedbackAdapter,
  PendingAttachment,
  ThreadMessageLike,
} from "@assistant-ui/react";
import type {
  Conversation,
  Message,
  RunView,
  FileView,
} from "../../lib/agent21/types";
import {
  SITE,
  isChartFile,
  sandboxFile,
  terminal,
} from "../../lib/agent21/types";
import { AgentAvatar } from "./agent-avatar";
import { AnswerBlock } from "./answer/blocks";
import { ChartFrame } from "./answer/chart-card";
import { ConversationFiles } from "./answer/context";
import {
  BLOCK_LANGUAGES,
  placedCharts,
  plainAnswer,
  tidyProse,
} from "../../lib/agent21/blocks";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/agent21/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  // A platform error page (a gateway timeout, say) is not JSON.
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const reference =
      typeof data?.requestId === "string" && uuid.test(data.requestId)
        ? ` Reference: ${data.requestId}`
        : "";
    throw new ApiError(
      (data?.error || "Agent 21 is unavailable.") + reference,
      response.status,
    );
  }
  return data;
}
const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
function Files({ files }: { files: FileView[] }) {
  return (
    <div className="a21-files">
      {files.map((file) => (
        <div className="a21-file" key={file.id}>
          {isChartFile(file.name) && <ChartFrame file={file} />}
          {file.type === "image/png" && (
            // Private, authenticated downloads cannot use the image optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/agent21/files/${file.id}`}
              alt={file.name}
              loading="lazy"
            />
          )}
          <a
            href={`/api/agent21/files/${file.id}`}
            download={file.type !== "image/png"}
          >
            {file.name} ↓
          </a>
        </div>
      ))}
    </div>
  );
}
function MarkdownLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  const files = useContext(ConversationFiles);
  if (href?.startsWith("https://"))
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  const file = sandboxFile(href, files);
  if (file)
    return (
      <a
        href={`/api/agent21/files/${file.id}`}
        download={file.type !== "image/png"}
      >
        {children}
      </a>
    );
  // Any other link has no safe target; show its text without a dead link.
  return <span>{children}</span>;
}
// Each a21-* fence is an answer block, drawn by the shared components.
const blockLanguages = Object.fromEntries(
  BLOCK_LANGUAGES.map((language) => [
    language,
    { CodeHeader: () => null, SyntaxHighlighter: AnswerBlock },
  ]),
);
const Markdown = () => (
  <MarkdownTextPrimitive
    className="a21-markdown"
    preprocess={tidyProse}
    components={{ img: () => null, a: MarkdownLink }}
    componentsByLanguage={blockLanguages}
  />
);
/** Copies the answer with each block as plain text, never its JSON. */
function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy answer"
      data-copied={copied || undefined}
      onClick={() =>
        void navigator.clipboard.writeText(plainAnswer(text)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
function AssistantMessage() {
  const files = useAuiState((s) => s.message.metadata.custom.files) as
    FileView[] | undefined;
  const text = useAuiState((s) =>
    s.message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n"),
  );
  const running = useAuiState((s) => s.message.status?.type === "running");
  // Charts a block places in the text are not repeated under the answer.
  const placed = useMemo(() => placedCharts(text), [text]);
  const listed = files?.filter((file) => !placed.has(file.name));
  // The thread's placeholder while a message is sent: the Working card stands
  // in for it until the answer's text arrives.
  if (running && !text.trim()) return null;
  return (
    <MessagePrimitive.Root className="a21-message a21-assistant">
      <div className="a21-speaker">
        <AgentAvatar size={24} /> Agent 21
      </div>
      <MessagePrimitive.Parts components={{ Text: Markdown }} />
      {listed && listed.length > 0 && <Files files={listed} />}
      <ActionBarPrimitive.Root className="a21-actions" hideWhenRunning>
        <CopyAnswer text={text} />
        <ActionBarPrimitive.FeedbackPositive aria-label="Helpful answer">
          Helpful
        </ActionBarPrimitive.FeedbackPositive>
        <ActionBarPrimitive.FeedbackNegative aria-label="Unhelpful answer">
          Needs work
        </ActionBarPrimitive.FeedbackNegative>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}
/** Whole seconds since a time, updated every second. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{Math.max(0, Math.round((now - since) / 1000))}s</>;
}
/**
 * Shown in the thread while an answer is on its way and none of its text has
 * arrived: what the agent is doing, how long it has been working and its
 * latest progress note.
 */
function Working({
  progress,
  note,
  since,
}: {
  progress: string;
  note: string;
  since: number;
}) {
  return (
    <div className="a21-message a21-working" role="status" aria-live="polite">
      <div className="a21-speaker">
        <AgentAvatar size={24} /> Agent 21
      </div>
      <p className="a21-working-line">
        <span className="a21-pulse" aria-hidden="true" />
        {progress}
        <span className="a21-elapsed">
          <Elapsed since={since} />
        </span>
      </p>
      {note && <p className="a21-working-note">{note}</p>}
    </div>
  );
}
function Attachment({ removable = false }: { removable?: boolean }) {
  const status = useAuiState((s) => s.attachment.status);
  const failed = status.type === "incomplete";
  return (
    <AttachmentPrimitive.Root
      className={
        failed ? "a21-attachment a21-attachment-failed" : "a21-attachment"
      }
      title={failed ? status.message : undefined}
    >
      <AttachmentPrimitive.Name />
      {status.type === "running" && <span>uploading…</span>}
      {failed && <span>not uploaded</span>}
      {removable && (
        <AttachmentPrimitive.Remove aria-label="Remove attachment">
          ×
        </AttachmentPrimitive.Remove>
      )}
    </AttachmentPrimitive.Root>
  );
}
function UserMessage() {
  return (
    <MessagePrimitive.Root className="a21-message a21-user">
      <MessagePrimitive.Parts />
      <div className="a21-attachments">
        <MessagePrimitive.Attachments>
          {() => <Attachment />}
        </MessagePrimitive.Attachments>
      </div>
    </MessagePrimitive.Root>
  );
}
const asAttachment = (file: FileView) => ({
  id: file.id,
  type: "document" as const,
  name: file.name,
  contentType: file.type,
  status: { type: "complete" as const },
  content: [],
});
type Loaded = {
  id: string;
  messages: Message[];
  run: RunView | null;
  files: FileView[];
};
const fetchConversation = (id: string): Promise<Loaded> =>
  api<Omit<Loaded, "id">>(`conversations/${id}`).then((value) => ({
    id,
    ...value,
  }));
/**
 * Clerk's account button. Without a profile photo the account shows its
 * initial on an orange disc instead of Clerk's generated avatar.
 */
// True only in the browser after hydration, so client-only widgets render
// after the server's HTML has been matched.
const noSubscribe = () => () => {};
const useMounted = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
function AccountButton({ onDeleteData }: { onDeleteData: () => void }) {
  const { user } = useUser();
  const mounted = useMounted();
  const initial = (
    user?.firstName ||
    user?.primaryEmailAddress?.emailAddress ||
    ""
  )
    .charAt(0)
    .toUpperCase();
  // Clerk's button is client-only; the server renders a placeholder its size.
  if (!mounted)
    return (
      <span className="a21-account-button a21-account-ph" aria-hidden="true" />
    );
  return (
    <span
      className="a21-account-button"
      data-initial={user && !user.hasImage ? initial || "₿" : undefined}
    >
      <UserButton
        appearance={{
          variables: {
            colorPrimary: "#f7931a",
            fontFamily: '"JetBrains Mono", monospace',
          },
        }}
      >
        {/* Deleting every Agent 21 chat and file lives in the account menu;
            the page asks for confirmation first. */}
        <UserButton.MenuItems>
          <UserButton.Action
            label="Delete my Agent 21 data"
            labelIcon={<span aria-hidden="true">×</span>}
            onClick={onDeleteData}
          />
        </UserButton.MenuItems>
      </UserButton>
    </span>
  );
}
type Spend = { spentUsd: number; limitUsd: number };
/** The account's estimated spend against its beta allowance, refreshed whenever an answer starts or ends. */
function SpendMeter({ refresh }: { refresh: string }) {
  const [spend, setSpend] = useState<Spend | null>(null);
  useEffect(() => {
    let live = true;
    api<Spend>("usage")
      .then((value) => live && setSpend(value))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [refresh]);
  if (!spend) return null;
  const used = Math.min(1, spend.spentUsd / spend.limitUsd);
  const spent = `$${spend.spentUsd.toFixed(2)}`;
  const limit = `$${spend.limitUsd.toLocaleString("en-US")}`;
  return (
    <p
      className="a21-spend"
      data-full={used >= 1 || undefined}
      title="Estimated Agent 21 spend during the beta"
    >
      <span>
        <b>{spent}</b> of {limit}
      </span>
      <span className="a21-spend-bar" aria-hidden="true">
        <span style={{ width: `${used * 100}%` }} />
      </span>
    </p>
  );
}
export function Chat() {
  const params = useParams<{ conversation?: string }>();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(
    params.conversation || null,
  );
  const [threads, setThreads] = useState<Conversation[]>([]);
  // Data belongs to the conversation it was loaded for, so switching shows
  // nothing stale while the next one loads.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = loaded?.id === selected ? loaded : null;
  const history = current?.messages ?? [];
  const run = current?.run ?? null;
  const files = current?.files ?? [];
  const [error, setError] = useState("");
  const loading = Boolean(selected && !current && !error);
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const [deletion, setDeletion] = useState<string>();
  const [archivedView, setArchivedView] = useState(false);
  const [notice, setNotice] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; title: string }>();
  const [confirming, setConfirming] = useState<string>();
  const [confirmingAccount, setConfirmingAccount] = useState(false);
  // On phones the history is a drawer opened from the header.
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (!drawer) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [drawer]);
  const pendingCancel = useRef(false);
  const pendingRequest = useRef<{
    text: string;
    conversation: string;
    requestId: string;
    fileIds: string[];
  } | null>(null);
  // The conversation in view, readable from async callbacks; uploads may
  // create the conversation before the first message is sent.
  const selection = useRef(selected);
  const setRun = useCallback(
    (id: string, update: (run: RunView) => RunView) =>
      setLoaded((previous) =>
        previous?.run?.id === id
          ? { ...previous, run: update(previous.run) }
          : previous,
      ),
    [],
  );
  const refreshThreads = useCallback(async () => {
    setThreads(await api<Conversation[]>("conversations"));
  }, []);
  const load = useCallback(async (id: string) => {
    const value = await fetchConversation(id);
    if (selection.current === id) setLoaded(value);
  }, []);
  const show = useCallback((id: string | null) => {
    selection.current = id;
    setSelected(id);
    setDrawer(false);
    setError("");
    setNotice("");
    window.history.pushState({}, "", id ? `/c/${id}` : "/");
  }, []);
  // A deleted conversation, or another account's, opens a new one instead.
  const unavailable = useCallback(() => {
    selection.current = null;
    setSelected(null);
    setNotice(
      "That conversation is not available. It may have been deleted, or it belongs to another account.",
    );
    window.history.replaceState({}, "", "/");
  }, []);
  useEffect(() => {
    api<Conversation[]>("conversations").then(setThreads, (e) =>
      setError(e.message),
    );
  }, []);
  useEffect(() => {
    if (!selected) return;
    let stale = false;
    fetchConversation(selected).then(
      (value) => !stale && setLoaded(value),
      (e) => {
        if (stale) return;
        if (e instanceof ApiError && e.status === 404) unavailable();
        else setError(e.message);
      },
    );
    return () => {
      stale = true;
    };
  }, [selected, unavailable]);
  useEffect(() => {
    const changed = () => {
      const id = window.location.pathname.split("/")[2] || null;
      selection.current = id;
      setSelected(id);
      setError("");
      setNotice("");
    };
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  const active = Boolean(
    run && !terminal(run.state) && run.state !== "unknown",
  );
  // Live progress arrives over server-sent events; the browser reconnects
  // when the server closes the stream, until the run settles.
  const runId = run?.id;
  useEffect(() => {
    if (!runId || !active || !selected) return;
    const id = runId;
    const conversation = selected;
    const events = new EventSource(`/api/agent21/runs/${id}/stream`);
    events.onmessage = (frame) => {
      if (selection.current !== conversation) return events.close();
      const event = JSON.parse(frame.data);
      if (event.type === "text")
        setRun(id, (previous) => ({ ...previous, text: event.text }));
      if (event.type === "progress")
        setRun(id, (previous) => ({
          ...previous,
          progress: event.progress,
          note: event.note,
        }));
      if (event.type === "snapshot") {
        // A reconnect's snapshot comes before the replayed events, so it
        // keeps the progress and text already shown while the run works,
        // unless the server has a message of its own (sending, retrying).
        setRun(id, (previous) =>
          terminal(event.run.state) || event.run.state === "unknown"
            ? event.run
            : {
                ...event.run,
                text: event.run.text || previous.text,
                progress: event.run.progress || previous.progress,
                note: event.run.note || previous.note,
              },
        );
        if (terminal(event.run.state) || event.run.state === "unknown") {
          events.close();
          void load(conversation).then(refreshThreads);
        }
      }
    };
    events.onerror = () => {
      if (events.readyState === EventSource.CLOSED)
        setError(
          "The connection was interrupted. Your response will continue in the background.",
        );
    };
    return () => events.close();
  }, [runId, active, selected, load, refreshThreads, setRun]);
  // A delayed run settles on the server within its hard deadline; keep checking.
  useEffect(() => {
    if (run?.state !== "unknown" || !selected) return;
    const conversation = selected;
    const timer = setInterval(
      () => void load(conversation).catch(() => undefined),
      15_000,
    );
    return () => clearInterval(timer);
  }, [run?.state, selected, load]);
  // A new conversation, or one whose sandbox has expired, otherwise waits 30
  // to 50 seconds for its sandbox after sending. One starts when the page or
  // conversation opens, and again when the user returns or writes after the
  // last one has expired (five minutes unused); it costs nothing until a
  // message uses it. The server keeps at most one per account.
  const warmed = useRef<{ key: string; at: number } | null>(null);
  const warm = useCallback(() => {
    if (active) return;
    const key = selection.current ?? "new";
    const last = warmed.current;
    if (last?.key === key && Date.now() - last.at < 60_000) return;
    warmed.current = { key, at: Date.now() };
    void api(
      "warm",
      "POST",
      selection.current ? { conversationId: key } : {},
    ).catch(() => {
      warmed.current = null;
    });
  }, [active]);
  useEffect(() => {
    warm();
    const back = () => {
      if (document.visibilityState === "visible") warm();
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [selected, warm]);
  const create = useCallback(async () => {
    const { id } = await api<{ id: string }>("conversations", "POST", {
      requestId: crypto.randomUUID(),
    });
    show(id);
    await refreshThreads();
    return id;
  }, [show, refreshThreads]);
  const rendered: ThreadMessageLike[] = history.map((m) => ({
    id: m.id,
    role: m.role,
    content: [{ type: "text", text: m.text }],
    createdAt: new Date(m.createdAt),
    ...(m.role === "user"
      ? { attachments: (m.files || []).map(asAttachment) }
      : {}),
    metadata: {
      custom: { files: m.role === "assistant" ? m.files || [] : [] },
      ...(m.feedback ? { submittedFeedback: { type: m.feedback } } : {}),
    },
  }));
  if (run && active && run.text)
    rendered.push({
      id: `live-${run.id}`,
      role: "assistant",
      content: [{ type: "text", text: run.text }],
      status: { type: "running" },
      metadata: { custom: { files: [] } },
    });
  const threadList = useMemo<ExternalStoreThreadListAdapter>(() => {
    const item = (t: Conversation) => ({ id: t.id, title: t.title });
    const update = (id: string, body: object) =>
      api(`conversations/${id}`, "PATCH", body)
        .then(refreshThreads)
        .catch((e) =>
          setError(message(e, "Conversation could not be updated.")),
        );
    return {
      threadId: selected ?? undefined,
      threads: threads
        .filter((t) => !t.archived)
        .map((t) => ({ ...item(t), status: "regular" as const })),
      archivedThreads: threads
        .filter((t) => t.archived)
        .map((t) => ({ ...item(t), status: "archived" as const })),
      onSwitchToNewThread: () => show(null),
      onSwitchToThread: (id) => show(id),
      onRename: (id, title) => update(id, { title }),
      onArchive: (id) => update(id, { archived: true }),
      onUnarchive: (id) => update(id, { archived: false }),
      // The menu asks for confirmation in the page before calling this.
      onDelete: async (id) => {
        setConfirming(undefined);
        try {
          const receipt = await api<{ deletionId: string }>(
            `conversations/${id}`,
            "DELETE",
          );
          setDeletion(receipt.deletionId);
          if (selection.current === id) show(null);
          await refreshThreads();
        } catch (e) {
          setError(message(e, "Conversation could not be deleted."));
        }
      },
    };
  }, [threads, selected, show, refreshThreads]);
  // Files upload as soon as they are attached, so sending only references them.
  const attachments = useMemo<AttachmentAdapter>(
    () => ({
      accept: ".csv,.pdf,text/csv,application/pdf",
      async *add({ file }) {
        const name = file.name.toLowerCase();
        const type = name.endsWith(".csv")
          ? "text/csv"
          : name.endsWith(".pdf")
            ? "application/pdf"
            : null;
        if (!type || file.size > 10 * 1024 ** 2) {
          // A file refused here never reaches the composer, so say why.
          const refusal = `${file.name} was not attached. Use CSV or PDF files up to 10 MiB.`;
          setError(refusal);
          throw Error(refusal);
        }
        setError("");
        const conversation = selection.current || (await create());
        const authorization = await api<{ fileId: string; pathname: string }>(
          `conversations/${conversation}/uploads`,
          "POST",
          { name: file.name, bytes: file.size, type },
        );
        const pending: PendingAttachment = {
          id: authorization.fileId,
          type: "document",
          name: file.name,
          contentType: type,
          file,
          status: { type: "running", reason: "uploading", progress: 0 },
        };
        yield pending;
        try {
          await uploadPresigned(authorization.pathname, file, {
            access: "private",
            handleUploadUrl: "/api/agent21/blob",
            contentType: type,
          });
          await api(`files/${authorization.fileId}/complete`, "POST", {});
        } catch (e) {
          setError(message(e, "Upload failed."));
          throw e;
        }
        yield {
          ...pending,
          status: { type: "requires-action", reason: "composer-send" },
        };
      },
      // A refused upload keeps its chip; sending with it returns the whole
      // draft to the composer so nothing typed is lost.
      send: async (attachment) => {
        if (attachment.status.type !== "requires-action") {
          const refusal = `Remove ${attachment.name}, which was not uploaded, then send again.`;
          setError(refusal);
          throw Error(refusal);
        }
        return { ...attachment, status: { type: "complete" }, content: [] };
      },
      remove: async (attachment) => {
        await api(`files/${attachment.id}`, "DELETE").catch(() => undefined);
      },
    }),
    [create],
  );
  const feedback = useMemo<FeedbackAdapter>(
    () => ({
      submit: ({ message: answer, type }) => {
        const conversation = selection.current;
        if (!conversation || !uuid.test(answer.id)) return;
        void api(`conversations/${conversation}/feedback`, "POST", {
          messageId: answer.id,
          type,
        }).catch(() => setError("Feedback could not be saved."));
      },
    }),
    [],
  );
  const runtime = useExternalStoreRuntime({
    messages: rendered,
    convertMessage: (m) => m,
    isRunning: active || sending,
    isLoading: loading,
    isSendDisabled: sending || run?.state === "unknown",
    adapters: { threadList, attachments, feedback },
    onNew: async (input) => {
      pendingCancel.current = false;
      setSentAt(Date.now());
      setSending(true);
      setError("");
      setNotice("");
      try {
        const text = input.content
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        const fileIds = (input.attachments ?? []).map((a) => a.id);
        const id = selection.current || (await create());
        const previous = pendingRequest.current;
        // A resend of an unconfirmed message keeps its request ID, so the
        // server answers it once; changed attachments make it a new message.
        const request =
          previous &&
          previous.text === text &&
          previous.conversation === id &&
          previous.fileIds.join() === fileIds.join()
            ? previous
            : {
                text,
                conversation: id,
                requestId: crypto.randomUUID(),
                fileIds,
              };
        pendingRequest.current = request;
        const next = await api<RunView>(
          `conversations/${id}/messages`,
          "POST",
          {
            requestId: request.requestId,
            text,
            fileIds: request.fileIds,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        );
        pendingRequest.current = null;
        if (pendingCancel.current)
          await api(`runs/${next.id}/cancel`, "POST", {});
        await load(id);
        await refreshThreads();
      } catch (e) {
        const reason = message(e, "Message could not be sent.");
        setError(reason);
        // Hands the text and attachments back to the composer; a resend
        // keeps the request ID, so the server still answers it only once.
        throw new MessageNotSentError(reason);
      } finally {
        setSending(false);
      }
    },
    onCancel: async () => {
      pendingCancel.current = true;
      if (run) await api(`runs/${run.id}/cancel`, "POST", {});
    },
  });
  // Files whose type the picker does not accept never reach the adapter.
  useEffect(
    () =>
      runtime.thread.composer.unstable_on("attachmentAddError", (event) => {
        if (event.reason === "not-accepted")
          setError(
            "That file was not attached. Use CSV or PDF files up to 10 MiB.",
          );
      }),
    [runtime],
  );
  const stop = async () => {
    if (!run) return;
    try {
      await api(`runs/${run.id}/cancel`, "POST", {});
    } catch (e) {
      setError(message(e, "Could not stop."));
    }
  };
  const removeFile = async (file: FileView) => {
    try {
      const receipt = await api<{ deletionId: string }>(
        `files/${file.id}`,
        "DELETE",
      );
      setDeletion(receipt.deletionId);
      if (selection.current) await load(selection.current);
    } catch (e) {
      setError(message(e, "File could not be deleted."));
    }
  };
  const deleteAccount = async () => {
    setConfirmingAccount(false);
    try {
      const receipt = await api<{ deletionId: string }>(
        "account-data",
        "DELETE",
      );
      router.push(`/deletion/${receipt.deletionId}`);
    } catch (e) {
      setError(message(e, "Deletion failed."));
    }
  };
  const uploads = files.filter((f) => f.kind === "upload");
  const linkable = useMemo(
    () => [
      ...(current?.files ?? []),
      ...(current?.messages ?? []).flatMap((m) => m.files ?? []),
    ],
    [current],
  );
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ConversationFiles.Provider value={linkable}>
        <div className="a21-shell">
          {drawer && (
            <button
              className="a21-backdrop"
              aria-label="Close conversation history"
              onClick={() => setDrawer(false)}
            />
          )}
          <aside
            id="a21-history"
            className="a21-sidebar"
            data-open={drawer || undefined}
          >
            <a className="a21-brand" href={SITE}>
              <span className="a21-accent">{"//"}</span> SECRET SATOSHIS
            </a>
            <ThreadListPrimitive.Root className="a21-threads">
              <ThreadListPrimitive.New className="a21-new">
                + New conversation
              </ThreadListPrimitive.New>
              <div className="a21-history-head">
                <span>{archivedView ? "Archived" : "Conversations"}</span>
                <button onClick={() => setArchivedView(!archivedView)}>
                  {archivedView ? "Active" : "Archived"}
                </button>
              </div>
              <nav aria-label="Chat history">
                <ThreadListPrimitive.Items archived={archivedView}>
                  {({ threadListItem }) => {
                    const id = threadListItem.id;
                    const title = threadListItem.title || "New conversation";
                    if (renaming?.id === id)
                      return (
                        <form
                          className="a21-thread a21-rename"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const next = renaming.title.trim();
                            setRenaming(undefined);
                            if (next && next !== threadListItem.title)
                              void threadList.onRename?.(id, next);
                          }}
                        >
                          <input
                            aria-label="Conversation title"
                            value={renaming.title}
                            maxLength={100}
                            autoFocus
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) =>
                              setRenaming({ id, title: event.target.value })
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape")
                                setRenaming(undefined);
                            }}
                          />
                          <button type="submit">Save</button>
                          <button
                            type="button"
                            onClick={() => setRenaming(undefined)}
                          >
                            Cancel
                          </button>
                        </form>
                      );
                    if (confirming === id)
                      return (
                        <div
                          className="a21-thread a21-confirm"
                          role="alertdialog"
                          aria-label={`Delete ${title}`}
                        >
                          <p>Delete “{title}” and its files?</p>
                          <button
                            className="a21-danger"
                            onClick={() => void threadList.onDelete?.(id)}
                          >
                            Delete
                          </button>
                          <button
                            autoFocus
                            onClick={() => setConfirming(undefined)}
                          >
                            Cancel
                          </button>
                        </div>
                      );
                    // Rename and Delete replace the row itself, so the short,
                    // scrolling history list cannot clip them.
                    const closeMenu = (element: HTMLElement) =>
                      element.closest("details")?.removeAttribute("open");
                    return (
                      <ThreadListItemPrimitive.Root className="a21-thread">
                        <ThreadListItemPrimitive.Trigger>
                          <ThreadListItemPrimitive.Title fallback="New conversation" />
                        </ThreadListItemPrimitive.Trigger>
                        <details>
                          <summary aria-label={`Manage ${title}`}>⋯</summary>
                          <button
                            onClick={(event) => {
                              closeMenu(event.currentTarget);
                              setRenaming({
                                id,
                                title: threadListItem.title ?? "",
                              });
                            }}
                          >
                            Rename
                          </button>
                          {archivedView ? (
                            <ThreadListItemPrimitive.Unarchive>
                              Restore
                            </ThreadListItemPrimitive.Unarchive>
                          ) : (
                            <ThreadListItemPrimitive.Archive>
                              Archive
                            </ThreadListItemPrimitive.Archive>
                          )}
                          <button
                            onClick={(event) => {
                              closeMenu(event.currentTarget);
                              setConfirming(id);
                            }}
                          >
                            Delete
                          </button>
                        </details>
                      </ThreadListItemPrimitive.Root>
                    );
                  }}
                </ThreadListPrimitive.Items>
              </nav>
            </ThreadListPrimitive.Root>
            <div className="a21-account">
              <AccountButton onDeleteData={() => setConfirmingAccount(true)} />
              <span>Private beta</span>
              <a href={`${SITE}/privacy.html`}>Privacy</a>
              {confirmingAccount && (
                <div className="a21-confirm" role="alertdialog">
                  <p>Delete all your Agent 21 chats and files?</p>
                  <button
                    className="a21-danger"
                    onClick={() => void deleteAccount()}
                  >
                    Delete everything
                  </button>
                  <button onClick={() => setConfirmingAccount(false)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </aside>
          <main className="a21-main">
            <header>
              <button
                className="a21-drawer-toggle"
                aria-label="Conversation history"
                aria-controls="a21-history"
                aria-expanded={drawer}
                onClick={() => setDrawer(!drawer)}
              >
                ☰
              </button>
              <AgentAvatar size={34} />
              <div>
                <strong>Agent 21</strong>
                <span>Bitcoin-native AI agent</span>
              </div>
              <SpendMeter refresh={`${run?.id ?? ""}:${run?.state ?? ""}`} />
            </header>
            <ThreadPrimitive.Root className="a21-chat">
              <ThreadPrimitive.Viewport className="a21-viewport">
                <ThreadPrimitive.Empty>
                  <div className="a21-empty">
                    <AgentAvatar size={88} followPointer float />
                    <h1>What would you like to understand?</h1>
                    <p>
                      Explore Bitcoin with research, current data, and your own
                      files.
                    </p>
                    <div className="a21-starters">
                      {[
                        "Explain Bitcoin's realized price.",
                        "What are current Bitcoin transaction fees?",
                        "Compare Bitcoin adoption scenarios.",
                      ].map((text) => (
                        <button
                          key={text}
                          onClick={() => runtime.thread.composer.setText(text)}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                </ThreadPrimitive.Empty>
                <ThreadPrimitive.Messages
                  components={{ UserMessage, AssistantMessage }}
                />
                {(sending || (run && active && !run.text)) && (
                  <Working
                    progress={
                      (run && active && run.progress) ||
                      (sending ? "Sending your message" : "Starting")
                    }
                    note={(run && active && run.note) || ""}
                    since={run && active ? Date.parse(run.startedAt) : sentAt}
                  />
                )}
                {uploads.length > 0 && (
                  <details className="a21-sources">
                    <summary>Files in this conversation</summary>
                    <Files files={uploads} />
                    <div className="a21-attachments">
                      {uploads.map((f) => (
                        <button
                          key={f.id}
                          disabled={active}
                          onClick={() => void removeFile(f)}
                        >
                          Delete {f.name}
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </ThreadPrimitive.Viewport>
              <div className="a21-compose-area">
                {deletion && (
                  <p role="status">
                    Deletion requested.{" "}
                    <a href={`/deletion/${deletion}`}>View deletion status</a>
                  </p>
                )}
                {notice && <p role="status">{notice}</p>}
                {(error || run?.error) && (
                  <p className="a21-error" role="alert">
                    {error || run?.error}
                  </p>
                )}
                {run?.state === "unknown" && (
                  <>
                    <button onClick={() => selected && void load(selected)}>
                      Check status
                    </button>
                    <button onClick={() => void stop()}>
                      Stop this response
                    </button>
                  </>
                )}
                <ComposerPrimitive.Root className="a21-composer-box">
                  <div className="a21-attachments">
                    <ComposerPrimitive.Attachments>
                      {() => <Attachment removable />}
                    </ComposerPrimitive.Attachments>
                  </div>
                  <div className="a21-composer">
                    <ComposerPrimitive.AddAttachment
                      aria-label="Attach CSV or PDF"
                      disabled={active}
                      multiple
                    >
                      ＋
                    </ComposerPrimitive.AddAttachment>
                    <ComposerPrimitive.Input
                      placeholder="Ask Agent 21 about Bitcoin…"
                      aria-label="Message Agent 21"
                      rows={2}
                      onFocus={warm}
                      onKeyDown={warm}
                    />
                    {active || sending ? (
                      <ComposerPrimitive.Cancel aria-label="Stop response">
                        Stop
                      </ComposerPrimitive.Cancel>
                    ) : (
                      <ComposerPrimitive.Send aria-label="Send message">
                        ↑
                      </ComposerPrimitive.Send>
                    )}
                  </div>
                </ComposerPrimitive.Root>
                <p className="a21-disclaimer">
                  Verify important facts. Bitcoin education and research, not
                  personalized financial advice.
                </p>
              </div>
            </ThreadPrimitive.Root>
          </main>
        </div>
      </ConversationFiles.Provider>
    </AssistantRuntimeProvider>
  );
}
