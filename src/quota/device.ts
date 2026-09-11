/**
 * Device identity for the free-trial quota.
 *
 * WHAT THIS IS NOT
 * ----------------
 * A browser cannot read a MAC address. There is no web API for it and there
 * deliberately never has been: a hardware serial that survives every reset
 * would be a permanent supercookie. `os.networkInterfaces()` on the server
 * returns the SERVER's MAC, which is identical for every visitor. So a
 * MAC-based quota is not implementable, and anything claiming to be one is
 * measuring something else.
 *
 * WHAT THIS IS
 * ------------
 * Two weak signals, combined, deliberately conservative:
 *
 *   1. A signed httpOnly cookie carrying a random id. Survives navigation and
 *      restarts; cleared by clearing site data or opening a private window.
 *   2. A hash of IP + User-Agent + Accept-Language. Survives cookie clearing;
 *      collides for everyone behind one office NAT on the same browser build.
 *
 * A request is charged against BOTH, and refused if EITHER is exhausted. That
 * biases toward false refusals rather than free rides, which is the right way
 * round for a trial: an honest user who hits a collision can supply their own
 * key and is unblocked immediately.
 *
 * This is a speed bump, not a security control. A private window plus a VPN
 * resets it, and that is acceptable: five requests is not worth defending
 * harder than this. The real answer is accounts, which the brief scopes out.
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const DEVICE_COOKIE = "da_device";
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

/**
 * Signing stops a caller forging another device's id; it cannot stop them
 * deleting their own. An ephemeral secret means quota resets on restart, which
 * is fine for local dev and wrong for anything shared, hence the warning.
 */
const SECRET = (() => {
  const fromEnv = process.env.DEVICE_ID_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[quota] DEVICE_ID_SECRET is unset or too short; device ids reset on every restart.",
    );
  }
  return randomUUID();
})();

export interface DeviceIdentity {
  /** Stable per-browser id from the signed cookie. */
  readonly deviceId: string;
  /** Coarse network/browser hash. Catches cookie clearing, collides behind NAT. */
  readonly fingerprint: string;
  /** True when the cookie was missing or failed verification. */
  readonly isNew: boolean;
}

function sign(id: string): string {
  return createHmac("sha256", SECRET).update(id).digest("base64url");
}

function verify(value: string): string | null {
  const idx = value.lastIndexOf(".");
  if (idx <= 0) return null;
  const id = value.slice(0, idx);
  const provided = value.slice(idx + 1);
  const expected = sign(id);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? id : null;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * Client IP. Behind a proxy this comes from `x-forwarded-for`, which the client
 * can set themselves unless the proxy overwrites it, so treat it as a hint and
 * never as authentication.
 */
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() ?? "unknown";
}

export function identifyDevice(req: Request): DeviceIdentity {
  const raw = readCookie(req, DEVICE_COOKIE);
  const verified = raw ? verify(raw) : null;

  const fingerprint = createHash("sha256")
    .update(clientIp(req))
    .update(" ")
    .update(req.headers.get("user-agent") ?? "")
    .update(" ")
    .update(req.headers.get("accept-language") ?? "")
    .digest("base64url")
    .slice(0, 22);

  return {
    deviceId: verified ?? randomUUID(),
    fingerprint,
    isNew: verified === null,
  };
}

export interface CookieSpec {
  readonly name: string;
  readonly value: string;
  readonly options: {
    readonly httpOnly: boolean;
    readonly sameSite: "lax";
    readonly secure: boolean;
    readonly path: string;
    readonly maxAge: number;
  };
}

/** Cookie to set when the identity was newly minted. */
export function deviceCookie(deviceId: string): CookieSpec {
  return {
    name: DEVICE_COOKIE,
    value: `${deviceId}.${sign(deviceId)}`,
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE_S,
    },
  };
}
