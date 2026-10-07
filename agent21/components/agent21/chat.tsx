"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
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
import { SITE, isChartFile, terminal } from "../../lib/agent21/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  const data = await response.json();
  if (!response.ok) {
    const reference =
      typeof data.requestId === "string" && uuid.test(data.requestId)
        ? ` Reference: ${data.requestId}`
        : "";
    throw new Error((data.error || "Agent 21 is unavailable.") + reference);
  }
  return data;
}
const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
/**
 * Draws a <id>.chart.json file with the Chart Library renderer. The viewer is a
 * same-origin static page that runs only its own scripts; the payload reaches
 * it as data through postMessage, and its height comes back the same way.
 */
function ChartFrame({ file }: { file: FileView }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [payload, setPayload] = useState<{ title?: unknown } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/agent21/files/${file.id}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => active && setPayload(data))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [file.id]);
  useEffect(() => {
    const target = frame.current?.contentWindow;
    if (loaded && payload && target)
      target.postMessage(
        { type: "ss-chart-payload", payload },
        window.location.origin,
      );
  }, [loaded, payload]);
  useEffect(() => {
    const resize = (event: MessageEvent) => {
      const element = frame.current;
      if (
        !element ||
        event.origin !== window.location.origin ||
        event.source !== element.contentWindow ||
        event.data?.type !== "ss-chart-size" ||
        typeof event.data.height !== "number"
      )
        return;
      element.style.height = `${Math.min(Math.max(event.data.height, 320), 2400)}px`;
    };
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, []);
  if (failed)
    return <p className="a21-chart-error">This chart could not be loaded.</p>;
  return (
    <iframe
      ref={frame}
      className="a21-chart"
      src="/agent21-chart/viewer.html"
      title={typeof payload?.title === "string" ? payload.title : file.name}
      loading="lazy"
      onLoad={() => setLoaded(true)}
    />
  );
}
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
const Markdown = () => (
  <MarkdownTextPrimitive
    className="a21-markdown"
    components={{
      img: () => null,
      a: ({ href, children }) => (
        <a
          href={href?.startsWith("https://") ? href : undefined}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      ),
    }}
  />
);
function AssistantMessage() {
  const files = useAuiState((s) => s.message.metadata.custom.files) as
    FileView[] | undefined;
  return (
    <MessagePrimitive.Root className="a21-message a21-assistant">
      <div className="a21-speaker">
        <span>₿</span> Agent 21
      </div>
      <MessagePrimitive.Parts components={{ Text: Markdown }} />
      {files && <Files files={files} />}
      <ActionBarPrimitive.Root className="a21-actions" hideWhenRunning>
        <ActionBarPrimitive.Copy aria-label="Copy answer">
          Copy
        </ActionBarPrimitive.Copy>
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
const Attachment = ({ removable = false }: { removable?: boolean }) => (
  <AttachmentPrimitive.Root className="a21-attachment">
    <AttachmentPrimitive.Name />
    {removable && (
      <AttachmentPrimitive.Remove aria-label="Remove attachment">
        ×
      </AttachmentPrimitive.Remove>
    )}
  </AttachmentPrimitive.Root>
);
function UserMessage() {
  return (
    <MessagePrimitive.Root className="a21-message a21-user">
      <div className="a21-speaker">You</div>
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
  const [deletion, setDeletion] = useState<string>();
  const [archivedView, setArchivedView] = useState(false);
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
    setError("");
    window.history.pushState({}, "", id ? `/c/${id}` : "/");
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
      (e) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
  }, [selected]);
  useEffect(() => {
    const changed = () => {
      const id = window.location.pathname.split("/")[2] || null;
      selection.current = id;
      setSelected(id);
      setError("");
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
      if (event.type === "snapshot") {
        setRun(id, () => event.run);
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
      onDelete: async (id) => {
        if (!confirm("Delete this conversation and all of its retained files?"))
          return;
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
        if (!type || file.size > 10 * 1024 ** 2)
          throw Error("Use CSV or PDF files up to 10 MiB.");
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
      send: async (attachment) => ({
        ...attachment,
        status: { type: "complete" },
        content: [],
      }),
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
      setSending(true);
      setError("");
      try {
        const text = input.content
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        const fileIds = (input.attachments ?? []).map((a) => a.id);
        const id = selection.current || (await create());
        const previous = pendingRequest.current;
        const request =
          previous && previous.text === text && previous.conversation === id
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
          },
        );
        pendingRequest.current = null;
        if (pendingCancel.current)
          await api(`runs/${next.id}/cancel`, "POST", {});
        await load(id);
        await refreshThreads();
      } catch (e) {
        setError(message(e, "Message could not be sent."));
        throw e;
      } finally {
        setSending(false);
      }
    },
    onCancel: async () => {
      pendingCancel.current = true;
      if (run) await api(`runs/${run.id}/cancel`, "POST", {});
    },
  });
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
    if (
      !confirm(
        "Delete all your Agent 21 chats and files? This ends your beta access.",
      )
    )
      return;
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
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="a21-shell">
        <aside className="a21-sidebar">
          <a className="a21-brand" href={SITE}>
            {"// SECRET SATOSHIS"}
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
                {({ threadListItem }) => (
                  <ThreadListItemPrimitive.Root className="a21-thread">
                    <ThreadListItemPrimitive.Trigger>
                      <ThreadListItemPrimitive.Title fallback="New conversation" />
                    </ThreadListItemPrimitive.Trigger>
                    <details>
                      <summary aria-label={`Manage ${threadListItem.title}`}>
                        ⋯
                      </summary>
                      <button
                        onClick={() => {
                          const title = prompt(
                            "Conversation title",
                            threadListItem.title,
                          );
                          if (title)
                            void threadList.onRename?.(
                              threadListItem.id,
                              title,
                            );
                        }}
                      >
                        Rename
                      </button>
                      <ThreadListItemPrimitive.Archive>
                        Archive
                      </ThreadListItemPrimitive.Archive>
                      <ThreadListItemPrimitive.Unarchive>
                        Restore
                      </ThreadListItemPrimitive.Unarchive>
                      <ThreadListItemPrimitive.Delete>
                        Delete
                      </ThreadListItemPrimitive.Delete>
                    </details>
                  </ThreadListItemPrimitive.Root>
                )}
              </ThreadListPrimitive.Items>
            </nav>
          </ThreadListPrimitive.Root>
          <div className="a21-account">
            <UserButton />
            <span>Private beta</span>
            <a href={`${SITE}/privacy.html`}>Privacy</a>
            <button onClick={() => void deleteAccount()}>Delete my data</button>
          </div>
        </aside>
        <main className="a21-main">
          <header>
            <a href={SITE}>₿</a>
            <div>
              <strong>Agent 21</strong>
              <span>Bitcoin research & analysis</span>
            </div>
          </header>
          <ThreadPrimitive.Root className="a21-chat">
            <ThreadPrimitive.Viewport className="a21-viewport">
              <ThreadPrimitive.Empty>
                <div className="a21-empty">
                  <span>₿</span>
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
              {run?.progress && (
                <p role="status" aria-live="polite">
                  {run.progress}
                </p>
              )}
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
    </AssistantRuntimeProvider>
  );
}
