/**
 * A small TTL cache with a hard size cap. Used for hostname resolution,
 * whose keys come from the attacker-controlled Host header — an unbounded
 * map there could be grown without limit by sending random hosts.
 *
 * Map iteration order is insertion order, and `set` re-inserts, so the
 * first key is always the least recently written one: evicting it keeps
 * the cache at `maxEntries` without any extra bookkeeping.
 */
export class BoundedTtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>()

  constructor(
    readonly maxEntries: number,
    readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.entries.get(key)
    if (!hit) return undefined
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return hit.value
  }

  set(key: string, value: V): void {
    this.entries.delete(key)
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs })
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
