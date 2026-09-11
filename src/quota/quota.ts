/**
 * Trial quota policy.
 *
 * Requests on the shared key are limited per device. Requests on a
 * caller-supplied key are not limited at all: they cost us nothing, and
 * throttling someone's own credentials would be rude and pointless.
 */

import type { DeviceIdentity } from "@/quota/device";
import { usageStore, type UsageStore } from "@/quota/store";

export const TRIAL_LIMIT = Number(process.env.TRIAL_REQUEST_LIMIT ?? 5);

/**
 * Optional rolling window in hours. Unset means the allowance is a lifetime
 * trial rather than a daily one, which is what "5 requests to try it out"
 * usually means.
 */
const WINDOW_HOURS = process.env.TRIAL_WINDOW_HOURS
  ? Number(process.env.TRIAL_WINDOW_HOURS)
  : null;

export interface QuotaState {
  readonly mode: "byok" | "shared";
  readonly limit: number | null;
  readonly used: number;
  readonly remaining: number | null;
  readonly exhausted: boolean;
  /** ISO timestamp when the window rolls over, if a window is configured. */
  readonly resetsAt: string | null;
}

/**
 * `granted` answers "was THIS request allowed", which is not the same question
 * as `exhausted` ("is anything left after it"). The last allowed request is
 * both granted and exhausting; conflating the two refuses it by one.
 */
export interface QuotaDecision {
  readonly granted: boolean;
  readonly state: QuotaState;
}

export const UNLIMITED: QuotaState = {
  mode: "byok",
  limit: null,
  used: 0,
  remaining: null,
  exhausted: false,
  resetsAt: null,
};

/** Both signals are charged, so both are read. */
function keysFor(device: DeviceIdentity): readonly string[] {
  return [`d:${device.deviceId}`, `f:${device.fingerprint}`];
}

function windowStart(now: number): number | null {
  return WINDOW_HOURS ? now - WINDOW_HOURS * 3_600_000 : null;
}

async function usedCount(
  store: UsageStore,
  keys: readonly string[],
  now: number,
): Promise<{ used: number; oldest: number | null }> {
  const cutoff = windowStart(now);
  let used = 0;
  let oldest: number | null = null;

  for (const key of keys) {
    const record = await store.get(key);
    if (!record) continue;
    // A window that has fully elapsed means the record no longer counts.
    if (cutoff !== null && record.lastSeen < cutoff) continue;
    if (record.count > used) used = record.count;
    if (oldest === null || record.firstSeen < oldest) oldest = record.firstSeen;
  }
  return { used, oldest };
}

function state(used: number, oldest: number | null): QuotaState {
  const remaining = Math.max(0, TRIAL_LIMIT - used);
  return {
    mode: "shared",
    limit: TRIAL_LIMIT,
    used,
    remaining,
    exhausted: remaining === 0,
    resetsAt:
      WINDOW_HOURS && oldest !== null
        ? new Date(oldest + WINDOW_HOURS * 3_600_000).toISOString()
        : null,
  };
}

/** Read-only check, for rendering the badge without spending an allowance. */
export async function peekQuota(
  device: DeviceIdentity,
  mode: "byok" | "shared",
  store: UsageStore = usageStore,
): Promise<QuotaState> {
  if (mode === "byok") return UNLIMITED;
  const now = Date.now();
  const { used, oldest } = await usedCount(store, keysFor(device), now);
  return state(used, oldest);
}

/**
 * Charge one request. Returns the state AFTER charging, or the exhausted state
 * without charging if there was nothing left.
 *
 * Charged before the model call, not after: a failed model call still consumed
 * an Azure request on our key, and refunding on error would turn the quota into
 * a free retry loop for anyone who can make the call fail.
 */
export async function consumeQuota(
  device: DeviceIdentity,
  mode: "byok" | "shared",
  store: UsageStore = usageStore,
): Promise<QuotaDecision> {
  if (mode === "byok") return { granted: true, state: UNLIMITED };

  const now = Date.now();
  const keys = keysFor(device);
  const { used, oldest } = await usedCount(store, keys, now);

  // Nothing left: refuse WITHOUT incrementing, so a caller who keeps retrying
  // cannot inflate their own counter past the limit.
  if (used >= TRIAL_LIMIT) {
    return { granted: false, state: state(used, oldest) };
  }

  let highest = 0;
  let earliest: number | null = oldest;
  for (const key of keys) {
    const record = await store.increment(key, now);
    if (record.count > highest) highest = record.count;
    if (earliest === null || record.firstSeen < earliest) earliest = record.firstSeen;
  }
  return { granted: true, state: state(highest, earliest) };
}

/** Message shown when the allowance runs out. */
export function exhaustedMessage(): string {
  return (
    `You have used all ${TRIAL_LIMIT} trial requests on the shared key. ` +
    `Add your own Azure OpenAI key and endpoint in Settings to keep going -- ` +
    `your key is used for that request only and is never stored on the server.`
  );
}
