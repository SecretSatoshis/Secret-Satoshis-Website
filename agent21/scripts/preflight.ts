import { missingCredentials, required } from "../lib/agent21/config";
import { mcpServerUrl, openai } from "../lib/agent21/openai";
import { closeDatabase, db } from "../lib/agent21/db";
import { migrator } from "../lib/agent21/migrations";
import catalog from "../lib/agent21/contracts/operations.json";
import assert from "node:assert/strict";
import { logDiagnostic } from "../lib/agent21/diagnostics";
const missing = missingCredentials();
console.log("Managed runtime SDK and 27 public function contracts available.");
assert.equal(catalog.operations.length, 27);
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
    // One data server, plus optional hosted search and programmatic tool calling.
    const mcp = agent.tools.find((tool) => tool.type === "mcp");
    assert(
      agent.tools.every((tool) =>
        ["mcp", "web_search", "programmatic_tool_calling"].includes(tool.type),
      ),
      "The release declares an unreviewed tool type",
    );
    assert.equal(agent.tools.filter((tool) => tool.type === "mcp").length, 1);
    assert(mcp?.type === "mcp" && mcp.transport.type === "http");
    assert.equal(mcp.transport.server_url, mcpServerUrl());
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
