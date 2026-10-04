import { createHook, sleep } from "workflow";
async function tick(id: string) {
  "use step";
  const { advanceRun } = await import("../lib/agent21/runner");
  return advanceRun(id);
}
async function uncertain(id: string) {
  "use step";
  const { markUncertain } = await import("../lib/agent21/runner");
  await markUncertain(id);
}
// Kept in sync with runHookToken in lib/agent21/runner.ts; workflow code
// cannot import the runner, which uses Node APIs.
const hookToken = (id: string) => `agent21-run:${id}`;
/**
 * Drives one answer to completion. OpenAI session webhooks resume the hook as
 * soon as something changes; the timer covers missed events and local
 * development without webhooks. The run settles itself at its hard stop
 * (LIMITS.abandonMs), well before the iteration cap.
 */
export async function agent21Run(id: string) {
  "use workflow";
  const hook = createHook<{ type: string }>({ token: hookToken(id) });
  // Another workflow already drives this run.
  if (await hook.getConflict()) return;
  // Each await of the hook takes the next event, so one pending wait is
  // carried across timer wake-ups instead of being dropped.
  let event = Promise.resolve(hook);
  let failures = 0;
  for (let i = 0; i < 500; i++) {
    const { status, poll } = await tick(id);
    if (status === "done") return;
    failures = status === "failed" ? failures + 1 : 0;
    if (failures === 3) await uncertain(id);
    // Temporary failures back off 5, 10, 20, 40, then 60 seconds.
    const delay = failures ? Math.min(60, 5 * 2 ** (failures - 1)) : poll;
    const woken = await Promise.race([
      event.then(() => true),
      sleep(`${delay}s`).then(() => false),
    ]);
    if (woken) event = Promise.resolve(hook);
  }
  await uncertain(id);
}
async function cleanup(id: string) {
  "use step";
  const { performDeletion } = await import("../lib/agent21/deletion");
  const { logDiagnostic } = await import("../lib/agent21/diagnostics");
  // A failed pass is retried on the next loop, not by instant step retries.
  return performDeletion(id).catch((error) => {
    logDiagnostic(error, "deletion_failed");
    return false;
  });
}
export async function agent21Deletion(id: string) {
  "use workflow";
  for (let i = 0; i < 90; i++) {
    if (await cleanup(id)) return;
    await sleep("10s");
  }
}
async function cleanupFile(id: string) {
  "use step";
  const { performFileDeletion } = await import("../lib/agent21/deletion");
  const { logDiagnostic } = await import("../lib/agent21/diagnostics");
  return performFileDeletion(id).catch((error) => {
    logDiagnostic(error, "deletion_failed");
    return false;
  });
}
export async function agent21FileDeletion(id: string) {
  "use workflow";
  for (let i = 0; i < 90; i++) {
    if (await cleanupFile(id)) return;
    await sleep("10s");
  }
}
