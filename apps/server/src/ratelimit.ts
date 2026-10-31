export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}
  /** Returns true if the call is allowed (and records it). */
  take(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.max) { this.hits.set(key, recent); return false; }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(t);
    return true;
  }
  /** Count without recording (used for failure lockouts). */
  count(key: string): number {
    const t = this.now();
    return (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs).length;
  }
  record(key: string) { const a = this.hits.get(key) ?? []; a.push(this.now()); this.hits.set(key, a); }
  private prune(t: number) { for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k); }
}
