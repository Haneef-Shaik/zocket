/**
 * Trial-usage counters.
 *
 * In-memory on purpose for the MVP, with the consequences stated rather than
 * discovered: counts reset when the process restarts, and two server instances
 * would each grant a full allowance. Swapping this for Redis is a one-file
 * change, which is why the interface is separate from the policy in quota.ts.
 */

export interface UsageRecord {
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export interface UsageStore {
  get(key: string): Promise<UsageRecord | undefined>;
  increment(key: string, now: number): Promise<UsageRecord>;
  reset(key: string): Promise<void>;
}

/** Entries older than this are dropped so the map cannot grow without bound. */
const TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SWEEP_EVERY = 500;

export class MemoryUsageStore implements UsageStore {
  private readonly records = new Map<string, UsageRecord>();
  private writes = 0;

  async get(key: string): Promise<UsageRecord | undefined> {
    const record = this.records.get(key);
    if (record && Date.now() - record.lastSeen > TTL_MS) {
      this.records.delete(key);
      return undefined;
    }
    return record;
  }

  async increment(key: string, now: number): Promise<UsageRecord> {
    const existing = await this.get(key);
    const next: UsageRecord = existing
      ? { count: existing.count + 1, firstSeen: existing.firstSeen, lastSeen: now }
      : { count: 1, firstSeen: now, lastSeen: now };
    this.records.set(key, next);
    if (++this.writes % SWEEP_EVERY === 0) this.sweep(now);
    return next;
  }

  async reset(key: string): Promise<void> {
    this.records.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, record] of this.records) {
      if (now - record.lastSeen > TTL_MS) this.records.delete(key);
    }
  }
}

/**
 * Module-level singleton. Next.js dev mode reloads modules on edit, which
 * resets it; the global pin keeps counts stable across hot reloads so quota
 * behaviour can actually be tested locally.
 */
const globalRef = globalThis as unknown as { __daUsageStore?: UsageStore };

export const usageStore: UsageStore = (globalRef.__daUsageStore ??= new MemoryUsageStore());
