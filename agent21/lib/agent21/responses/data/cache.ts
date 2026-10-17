// A per-instance cache with a time-to-live that also merges concurrent loads of
// the same key, so parallel tool calls fetch a source once. Serverless
// instances are reused between requests, so daily data stays warm.
type Entry = { at: number; ttl: number; value: Promise<unknown> };
const entries = new Map<string, Entry>();
const MAX_ENTRIES = 500;

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  onHit?: () => void,
): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && now - hit.at < hit.ttl * 1000) {
    onHit?.();
    return hit.value as Promise<T>;
  }
  const value = load();
  entries.set(key, { at: now, ttl: ttlSeconds, value });
  if (entries.size > MAX_ENTRIES) {
    const oldest = [...entries.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of oldest.slice(0, entries.size - MAX_ENTRIES))
      entries.delete(k);
  }
  // A failed load is not kept, so the next call tries again.
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return value;
}

/** Test-only: forget everything. */
export function clearCache() {
  entries.clear();
}
