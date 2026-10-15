import { sql } from "kysely";
import { z } from "zod";
import { enabled, required } from "./config";
import { db, ownedConversation } from "./db";
import { environmentId, isProviderError, mcpVaultId, openai } from "./openai";

// The environment template installs its packages at every boot, so a cold
// sandbox takes 30 to 50 seconds before the agent can run anything. A sandbox
// pre-warmed while the user writes is free until a session attaches it, and
// expires unattached five minutes after creation; one older than this is not
// handed to a session, whose creation can take a few seconds more.
const WARM_MINUTES = 4;
// pending: still installing (a session can attach and waits for setup);
// ready: installed, unattached; connected: attached to a session.
const LIVE = new Set(["pending", "ready", "connected"]);

/** Whether a sandbox can still take work: expired and failed ones do not come back. */
export async function liveEnvironment(id: string) {
  try {
    const environment = await openai().beta.agents.environments.retrieve(id);
    return LIVE.has(environment.status);
  } catch (error) {
    if (isProviderError(error, 404)) return false;
    throw error;
  }
}
/** Whether a session and its sandbox can take the next message. */
export async function liveSession(id: string) {
  try {
    const session = await openai().beta.agents.sessions.retrieve(id);
    if (session.status === "failed") return undefined;
    return (await liveEnvironment(environmentId(session)))
      ? session
      : undefined;
  } catch (error) {
    if (isProviderError(error, 404)) return undefined;
    throw error;
  }
}
/**
 * Starts a sandbox from the environment template for the account's next new
 * session, unless the conversation's own sandbox is still running or a fresh
 * pre-warmed one is waiting. The browser asks when the user starts writing.
 */
export async function warmEnvironment(owner: string, body: unknown) {
  if (!enabled()) return { status: "off" as const };
  const { conversationId } = z
    .object({ conversationId: z.uuid().optional() })
    .strict()
    .parse(body);
  if (conversationId) {
    const conversation = await ownedConversation(owner, conversationId);
    if (conversation.session_id && (await liveSession(conversation.session_id)))
      return { status: "running" as const };
  }
  const template = required("AGENT21_ENVIRONMENT_TEMPLATE_ID");
  // One pre-warmed sandbox per account: claim the slot unless a fresh one for
  // this template holds it, so repeated requests start nothing new.
  const claimed = await db()
    .insertInto("agent21_warm_environments")
    .values({ owner_id: owner, template_id: template })
    .onConflict((oc) =>
      oc
        .column("owner_id")
        .doUpdateSet({
          template_id: template,
          environment_id: null,
          created_at: sql<Date>`now()`,
        })
        .where((eb) =>
          eb.or([
            eb(
              "agent21_warm_environments.created_at",
              "<",
              sql<Date>`now() - make_interval(mins => ${WARM_MINUTES})`,
            ),
            eb("agent21_warm_environments.template_id", "!=", template),
          ]),
        ),
    )
    .returning("owner_id")
    .executeTakeFirst();
  if (!claimed) return { status: "warming" as const };
  try {
    // A session's vaults must match its pre-warmed sandbox's, so the sandbox
    // carries the vault holding the GitHub MCP credential.
    const environment = await openai().beta.agents.environments.create({
      environment: { type: "openai_hosted", environment_template_id: template },
      ...(mcpVaultId() ? { vault_ids: [mcpVaultId()!] } : {}),
    });
    await db()
      .updateTable("agent21_warm_environments")
      .set({ environment_id: environment.id })
      .where("owner_id", "=", owner)
      .execute();
  } catch (error) {
    await db()
      .deleteFrom("agent21_warm_environments")
      .where("owner_id", "=", owner)
      .where("environment_id", "is", null)
      .execute();
    throw error;
  }
  return { status: "warming" as const };
}
/**
 * Takes the account's pre-warmed sandbox for a new session, once: the row is
 * removed whether or not the sandbox is still usable.
 */
export async function claimWarmEnvironment(owner: string, template: string) {
  const row = await db()
    .deleteFrom("agent21_warm_environments")
    .where("owner_id", "=", owner)
    .where("template_id", "=", template)
    .where("environment_id", "is not", null)
    .where(
      "created_at",
      ">",
      sql<Date>`now() - make_interval(mins => ${WARM_MINUTES})`,
    )
    .returning("environment_id")
    .executeTakeFirst();
  const id = row?.environment_id;
  return id && (await liveEnvironment(id)) ? id : undefined;
}
