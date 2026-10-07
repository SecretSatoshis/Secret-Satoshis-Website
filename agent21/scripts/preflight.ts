import { missingCredentials, required } from "../lib/agent21/config";
import { isGitHubServer, openai, sessionTools } from "../lib/agent21/openai";
import { closeDatabase, db } from "../lib/agent21/db";
import { migrator } from "../lib/agent21/migrations";
import assert from "node:assert/strict";
import { logDiagnostic } from "../lib/agent21/diagnostics";
import { AppError } from "../lib/agent21/errors";
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
    assert.equal(agent.multi_agent.enabled, false);
    // Sessions accept only reviewed tools: hosted search, BRK's keyless server
    // and GitHub's server limited to read tools.
    const tools = await sessionTools(agentId);
    const github = tools.find(
      (tool) =>
        tool.type === "mcp" &&
        tool.transport.type === "http" &&
        isGitHubServer(tool.transport.server_url),
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
    // This script's assertions and the app's own errors hold no credentials,
    // so say which check failed; provider errors stay sanitized.
    console.error(
      error instanceof assert.AssertionError || error instanceof AppError
        ? `Preflight check failed: ${error.message}`
        : "Provider preflight failed; inspect configuration and account permissions privately.",
    );
    process.exitCode = 1;
  } finally {
    await closeDatabase().catch((error) => {
      logDiagnostic(error, "preflight_failed", { provider: "neon" });
      process.exitCode = 1;
    });
  }
}
