import { missingCredentials, required } from "../lib/agent21/config";
import { BRK_MCP_URL, mcpServerUrl, openai } from "../lib/agent21/openai";
import { closeDatabase, db } from "../lib/agent21/db";
import { migrator } from "../lib/agent21/migrations";
import catalog from "../lib/agent21/contracts/operations.json";
import assert from "node:assert/strict";
import { logDiagnostic } from "../lib/agent21/diagnostics";
const missing = missingCredentials();
console.log(
  `Managed runtime SDK and ${catalog.operations.length} data-server contracts available.`,
);
if (missing.length) {
  console.error(
    `Live preflight blocked: configure ${missing.join(", ")} privately.`,
  );
  process.exitCode = 1;
} else {
  try {
    const api = openai();
    const agent = await api.beta.agents.retrieve(required("AGENT21_AGENT_ID"));
    // The release chooses the model; confirm this project can use it.
    await api.models.retrieve(agent.model);
    assert.equal(agent.reasoning.effort, "medium");
    assert.equal(agent.service_tier, "default");
    assert.equal(agent.multi_agent.enabled, false);
    assert.equal(agent.metadata.runtime, required("AGENT21_RUNTIME_VERSION"));
    // Our data server and BRK's keyless server, plus optional hosted search and
    // programmatic tool calling.
    assert(
      agent.tools.every((tool) =>
        ["mcp", "web_search", "programmatic_tool_calling"].includes(tool.type),
      ),
      "The release declares an unreviewed tool type",
    );
    const servers = agent.tools.flatMap((tool) =>
      tool.type === "mcp" && tool.transport.type === "http"
        ? [{ tool, url: tool.transport.server_url }]
        : [],
    );
    const ours = servers.find((server) => server.url === mcpServerUrl());
    assert(ours, "The release does not name the Agent 21 data server");
    assert(
      servers.length ===
        agent.tools.filter((tool) => tool.type === "mcp").length &&
        servers.every(
          (server) =>
            server === ours || new URL(server.url).href === BRK_MCP_URL,
        ),
      "The release names an unreviewed MCP server",
    );
    const mcp = ours.tool;
    assert.deepEqual(
      [...(mcp.allowed_tools ?? [])].sort(),
      catalog.operations.map((t) => t.name).sort(),
    );
    const template = await api.beta.agents.environments.templates.retrieve(
      required("AGENT21_ENVIRONMENT_TEMPLATE_ID"),
    );
    assert.equal(template.network.access, "enabled");
    assert.equal(template.desktop?.enabled, false);
    const pending = (await migrator(db()).getMigrations()).filter(
      (migration) => !migration.executedAt,
    );
    assert.equal(
      pending.length,
      0,
      "Apply all database migrations (pnpm migrate) before enabling Agent 21.",
    );
    console.log(
      "Provider/model/configuration/database checks passed. Hosted Python probe, invite settings, private storage and protected-preview acceptance still require verification in the runbook.",
    );
  } catch (error) {
    logDiagnostic(error, "preflight_failed");
    console.error(
      "Provider preflight failed; inspect configuration and account permissions privately.",
    );
    process.exitCode = 1;
  } finally {
    await closeDatabase().catch((error) => {
      logDiagnostic(error, "preflight_failed", { provider: "neon" });
      process.exitCode = 1;
    });
  }
}
