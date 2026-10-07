import { missingCredentials, required } from "../lib/agent21/config";
import { GITHUB_MCP_URL, openai, sessionTools } from "../lib/agent21/openai";
import { closeDatabase, db } from "../lib/agent21/db";
import { migrator } from "../lib/agent21/migrations";
import assert from "node:assert/strict";
import { logDiagnostic } from "../lib/agent21/diagnostics";
const missing = missingCredentials();
if (missing.length) {
  console.error(
    `Live preflight blocked: configure ${missing.join(", ")} privately.`,
  );
  process.exitCode = 1;
} else {
  try {
    const api = openai();
    const agentId = required("AGENT21_AGENT_ID");
    const agent = await api.beta.agents.retrieve(agentId);
    // The dashboard agent chooses the model; confirm this project can use it.
    await api.models.retrieve(agent.model);
    assert.equal(agent.reasoning.effort, "medium");
    assert.equal(agent.service_tier, "default");
    assert.equal(agent.multi_agent.enabled, false);
    // Sessions accept only reviewed tools: hosted search, programmatic tool
    // calling, BRK's keyless server and GitHub's read-only server.
    const tools = await sessionTools(agentId);
    const github = tools.find(
      (tool) =>
        tool.type === "mcp" &&
        tool.transport.type === "http" &&
        new URL(tool.transport.server_url).pathname ===
          new URL(GITHUB_MCP_URL).pathname,
    );
    assert(
      !github || (github.type === "mcp" && github.credential_id),
      "The GitHub MCP server needs its vault credential",
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
