import test from "node:test";
import assert from "node:assert/strict";
import { boundedBytes, safeArtifact, safeFilename } from "../lib/agent21/files";
import { validateUpload } from "../lib/agent21/validation";
import { verifyOrigin } from "../lib/agent21/auth";
import {
  publicText,
  hostedEnvironment,
  environmentId,
} from "../lib/agent21/openai";
import { PDFDocument } from "pdf-lib";
import {
  credentialNames,
  missingCredentials,
  configured,
} from "../lib/agent21/config";

test("webhook credentials are optional only for loopback development; production stays closed", () => {
  const names = [
    ...credentialNames,
    "NODE_ENV",
    "BLOB_STORE_ID",
    "BLOB_READ_WRITE_TOKEN",
  ];
  const before = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of credentialNames) process.env[name] = "configured";
    process.env.BLOB_STORE_ID = "store_configured";
    delete process.env.OPENAI_WEBHOOK_SECRET;
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    process.env.APP_ORIGIN = "http://localhost:3000";
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.deepEqual(missingCredentials(), [
      "OPENAI_WEBHOOK_SECRET",
      "CLERK_WEBHOOK_SIGNING_SECRET",
    ]);
    assert.equal(configured(), false);
    Object.assign(process.env, { NODE_ENV: "development" });
    assert.equal(configured(), true);
    process.env.APP_ORIGIN = "https://preview.example.com";
    assert.equal(configured(), false);
    process.env.APP_ORIGIN = "http://localhost:3000";
    delete process.env.DATABASE_URL;
    assert.equal(configured(), false);
    process.env.DATABASE_URL = "configured";
    delete process.env.BLOB_STORE_ID;
    assert.deepEqual(missingCredentials(), ["BLOB_STORE_ID"]);
    process.env.BLOB_READ_WRITE_TOKEN = "local-token";
    assert.equal(
      configured(),
      true,
      "Local development may use a read-write token",
    );
    // The GitHub MCP token reaches OpenAI only through the session's vault.
    delete process.env.AGENT21_MCP_VAULT_ID;
    assert.deepEqual(missingCredentials(), ["AGENT21_MCP_VAULT_ID"]);
    process.env.AGENT21_MCP_VAULT_ID = "vault_configured";
    assert.equal(configured(), true);
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});

test("bounded streaming rejects both declared and chunked oversized source responses", async () => {
  await assert.rejects(
    boundedBytes(new Response("x", { headers: { "content-length": "99" } }), 2),
  );
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    }),
  );
  await assert.rejects(boundedBytes(response, 2));
  assert.equal((await boundedBytes(new Response("ok"), 2)).toString(), "ok");
});
test("CSV validation preserves quoted delimiters/newlines and rejects corrupt files", async () => {
  for (const text of [
    "date,value\n2026-01-01,10\n",
    'name,note\r\n"a,b","two\nlines"\r\n',
    'value\n"escaped ""quote"""\n',
    "a,b\n1,2\n\n",
    "a,b\r\n\r\n1,2\r\n",
    "a,b\n  \n1,2",
    // Read by Python's csv module and pandas: spaces around a quoted field, and
    // a quote that does not open one.
    'a,b\n1, "2"\n',
    'a,b\n"1" ,2\n',
    'a,b\n1,x"y\n',
  ])
    await validateUpload(Buffer.from(text), "text/csv");
  for (const text of [
    "",
    "a,b\n1\n",
    "\n\n  \n",
    'a,b\n"unclosed,2',
    'a,b\n"value"extra,2',
    "<html>bad</html>",
    "a\0,b",
  ])
    await assert.rejects(validateUpload(Buffer.from(text), "text/csv"));
  await assert.rejects(
    validateUpload(Buffer.from([0xff, 0xff]), "text/csv"),
    /UTF-8/,
  );
});
test("PDF uploads require real readable unencrypted documents within page limits", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  await validateUpload(Buffer.from(await pdf.save()), "application/pdf");
  await assert.rejects(
    validateUpload(Buffer.from("%PDF-broken"), "application/pdf"),
  );
  await assert.rejects(
    validateUpload(Buffer.from("<html>pdf</html>"), "application/pdf"),
  );
  const huge = await PDFDocument.create();
  for (let i = 0; i < 201; i++) huge.addPage();
  await assert.rejects(
    validateUpload(Buffer.from(await huge.save()), "application/pdf"),
    /200 pages/,
  );
});
test("only bounded safe output files are published; control markers and credentials are rejected", () => {
  assert(
    safeArtifact(
      "/workspace/outputs/report.csv",
      Buffer.from("date,value\n2026-01-01,10"),
    ),
  );
  for (const path of [
    "/workspace/knowledge/index.md",
    "/workspace/outputs/../system_prompt.md",
    "/workspace/outputs/.env",
    "/workspace/outputs/archive.zip",
    "/workspace/outputs/subdir/report.csv",
  ])
    assert(!safeArtifact(path, Buffer.from("x")));
  for (const text of [
    "AGENT21_PRIVATE_CONTROL",
    "-----BEGIN PRIVATE KEY-----",
    "sk-proj-abcdefghijklmnopqrstuvwxyz",
  ])
    assert(!safeArtifact("/workspace/outputs/report.md", Buffer.from(text)));
  assert.equal(safeFilename('hello"\r\n.csv'), "hello___.csv");
});
test("mutation origin is exact; provider identifiers are never an authorization credential", () => {
  process.env.APP_ORIGIN = "https://secretsatoshis.com";
  verifyOrigin(
    new Request("https://secretsatoshis.com/api/agent21", {
      headers: { origin: "https://secretsatoshis.com" },
    }),
  );
  for (const origin of [
    "https://evil.example",
    "https://secretsatoshis.com.evil.example",
    "null",
  ]) {
    assert.throws(() =>
      verifyOrigin(
        new Request("https://secretsatoshis.com/api/agent21", {
          headers: { origin },
        }),
      ),
    );
  }
  assert.throws(() =>
    verifyOrigin(new Request("https://secretsatoshis.com/api/agent21")),
  );
});
test("browser output includes final assistant text only, never private reasoning/tool traces", () => {
  const items = [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "user" }],
    },
    {
      type: "message",
      role: "assistant",
      phase: "commentary",
      content: [{ type: "output_text", text: "internal commentary" }],
    },
    {
      type: "reasoning",
      summary: [{ type: "summary_text", text: "private reasoning" }],
    },
    {
      type: "message",
      role: "assistant",
      phase: "final_answer",
      content: [{ type: "output_text", text: "Bitcoin answer" }],
    },
  ];
  assert.equal(
    publicText(items as unknown as Parameters<typeof publicText>[0]),
    "Bitcoin answer",
  );
  assert.equal(
    hostedEnvironment("template").container_size,
    "small",
    "Sessions ask for the 1 GB sandbox",
  );
  assert(
    !("network" in hostedEnvironment("template")),
    "Network access comes from the dashboard template",
  );
  assert.throws(() => environmentId({ environment: { type: "none" } }));
});
test("sessions pass through only reviewed tools, and only GitHub carries a credential", async () => {
  const { default: OpenAI } = await import("openai");
  const { sessionTools, setOpenAIForTests, GITHUB_MCP_URL } =
    await import("../lib/agent21/openai");
  const before = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "test" });
  const mcp = (
    server_url: string,
    label: string,
    credential: string | null,
    allowed_tools: string[] | null = null,
  ) => ({
    type: "mcp",
    server_label: label,
    transport: { type: "http", server_url, headers: {} },
    allowed_tools,
    connection_origin: "service",
    credential_id: credential,
    request_metadata: null,
    required: false,
  });
  const brk = mcp("https://mcp.bitview.space", "brk", null);
  const reads = [
    "get_file_contents",
    "search_code",
    "list_commits",
    "get_commit",
  ];
  const github = mcp(GITHUB_MCP_URL, "github", "credential-dashboard", reads);
  const search = {
    type: "web_search",
    allowed_domains: null,
    context_size: "medium",
    location: null,
    mode: "live",
  };
  const release = (tools: object[]) =>
    new OpenAI({
      apiKey: "test-key",
      maxRetries: 0,
      fetch: async () => Response.json({ id: "agent", tools }),
    });
  try {
    setOpenAIForTests(release([brk, github, search]));
    const expected = await sessionTools("agent-expected");
    const [brkTool, githubTool, searchTool] = expected;
    // Programmatic tool calling keeps the provider default: nothing is added.
    assert.equal(expected.length, 3);
    // BRK's public server passes through with no credential.
    assert.deepEqual(brkTool, {
      type: "mcp",
      server_label: "brk",
      allowed_tools: null,
      connection_origin: "service",
      required: false,
      transport: { type: "http", server_url: "https://mcp.bitview.space" },
    });
    // GitHub keeps the dashboard's vault credential; no header is ever added.
    assert(githubTool.type === "mcp" && githubTool.transport.type === "http");
    assert.equal(githubTool.credential_id, "credential-dashboard");
    assert.equal(githubTool.transport.headers, undefined);
    assert.deepEqual(searchTool, search);
    // The read-only repository path is accepted with the same read tools.
    setOpenAIForTests(
      release([
        mcp(
          "https://api.githubcopilot.com/mcp/x/repos/readonly/",
          "github",
          "c",
          reads,
        ),
      ]),
    );
    const [readonly] = await sessionTools("agent-readonly");
    assert(readonly.type === "mcp" && readonly.credential_id === "c");
    // The agent's programmatic tool calling setting passes through, on or off.
    for (const enabled of [true, false]) {
      setOpenAIForTests(
        release([search, { type: "programmatic_tool_calling", enabled }]),
      );
      assert.deepEqual(
        (await sessionTools(`agent-programmatic-${enabled}`)).at(-1),
        { type: "programmatic_tool_calling", enabled },
      );
    }
    // GitHub with every tool allowed, or with a write tool, is refused.
    for (const [id, allowed] of [
      ["agent-github-all", null],
      ["agent-github-none", []],
      ["agent-github-write", [...reads, "create_or_update_file"]],
    ] as const) {
      setOpenAIForTests(
        release([mcp(GITHUB_MCP_URL, "github", "c", allowed && [...allowed])]),
      );
      await assert.rejects(sessionTools(id), /only read tools/);
    }
    // Any other server, another GitHub path or another tool type is refused.
    for (const [id, tool] of [
      ["agent-other", mcp("https://elsewhere.example/mcp", "x", null)],
      [
        "agent-other-path",
        mcp("https://api.githubcopilot.com/mcp/x/repos", "github", "c", reads),
      ],
      ["agent-desktop", { type: "computer_use", include_screenshots: true }],
    ] as const) {
      setOpenAIForTests(release([tool]));
      await assert.rejects(
        sessionTools(id),
        (error: Error & { code?: string }) =>
          /unexpected/.test(error.message) &&
          error.code === "agent_tools_rejected",
      );
    }
  } finally {
    Object.assign(process.env, { NODE_ENV: before });
  }
});
