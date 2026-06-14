/**
 * A tiny in-memory TTL cache for expensive reads (tracker fetches that spawn a
 * subprocess, CI queries that shell out). Caches the PROMISE, not the resolved
 * value, which gives two wins for free:
 *   - concurrent callers for the same key share one in-flight load (dedup), and
 *   - a reopened panel within the TTL is instant instead of re-spawning work.
 * A rejected load is evicted so failures aren't cached. `force` bypasses + refreshes.
 */
export class TtlCache {
  private entries = new Map<string, { value: Promise<unknown>; expires: number }>()

  async get<T>(key: string, ttlMs: number, loader: () => Promise<T>, force = false): Promise<T> {
    const now = Date.now()
    const hit = this.entries.get(key)
    if (!force && hit && hit.expires > now) return hit.value as Promise<T>

    const value = loader()
    const entry = { value, expires: now + ttlMs }
    this.entries.set(key, entry)
    // Don't cache a failure: drop this entry if the load rejects (unless it was
    // already replaced by a newer load for the same key).
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
    })
    return value
  }

  invalidate(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }
}
