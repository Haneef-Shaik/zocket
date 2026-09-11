import { describe, expect, it } from "vitest";
import { identifyDevice, deviceCookie, DEVICE_COOKIE } from "@/quota/device";
import { consumeQuota, peekQuota, TRIAL_LIMIT } from "@/quota/quota";
import { MemoryUsageStore } from "@/quota/store";

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/ask", { method: "POST", headers });
}

/** A browser that has already been issued a cookie. */
function returning(deviceId: string, extra: Record<string, string> = {}): Request {
  const c = deviceCookie(deviceId);
  return request({ cookie: `${DEVICE_COOKIE}=${encodeURIComponent(c.value)}`, ...extra });
}

describe("device identity", () => {
  it("mints a new id when there is no cookie", () => {
    const d = identifyDevice(request());
    expect(d.isNew).toBe(true);
    expect(d.deviceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("recognises a returning device by its signed cookie", () => {
    const first = identifyDevice(request());
    const second = identifyDevice(returning(first.deviceId));
    expect(second.isNew).toBe(false);
    expect(second.deviceId).toBe(first.deviceId);
  });

  it("rejects a forged cookie rather than trusting the id in it", () => {
    const forged = request({ cookie: `${DEVICE_COOKIE}=someone-elses-id.notavalidsignature` });
    const d = identifyDevice(forged);
    expect(d.isNew).toBe(true);
    expect(d.deviceId).not.toBe("someone-elses-id");
  });

  it("derives the same fingerprint for the same network and browser", () => {
    const headers = { "x-forwarded-for": "203.0.113.7", "user-agent": "Firefox/1", "accept-language": "en" };
    expect(identifyDevice(request(headers)).fingerprint).toBe(
      identifyDevice(request(headers)).fingerprint,
    );
  });

  it("derives different fingerprints for different networks", () => {
    const a = identifyDevice(request({ "x-forwarded-for": "203.0.113.7", "user-agent": "Firefox/1" }));
    const b = identifyDevice(request({ "x-forwarded-for": "198.51.100.9", "user-agent": "Firefox/1" }));
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe("trial quota on the shared key", () => {
  it(`allows exactly ${TRIAL_LIMIT} requests, then refuses`, async () => {
    const store = new MemoryUsageStore();
    const device = identifyDevice(request({ "x-forwarded-for": "1.2.3.4" }));

    for (let i = 1; i <= TRIAL_LIMIT; i++) {
      const { granted, state } = await consumeQuota(device, "shared", store);
      expect(granted).toBe(true); // including the last one
      expect(state.used).toBe(i);
      expect(state.remaining).toBe(TRIAL_LIMIT - i);
    }
    // The final allowed request exhausts the allowance without being refused.
    expect((await peekQuota(device, "shared", store)).exhausted).toBe(true);

    const over = await consumeQuota(device, "shared", store);
    expect(over.granted).toBe(false);
    expect(over.state.remaining).toBe(0);
  });

  it("does not charge for a request that was already refused", async () => {
    const store = new MemoryUsageStore();
    const device = identifyDevice(request());
    for (let i = 0; i < TRIAL_LIMIT + 3; i++) await consumeQuota(device, "shared", store);
    const q = await peekQuota(device, "shared", store);
    expect(q.used).toBe(TRIAL_LIMIT);
  });

  it("still counts after the cookie is cleared, via the fingerprint", async () => {
    const store = new MemoryUsageStore();
    const headers = { "x-forwarded-for": "203.0.113.7", "user-agent": "Safari/1" };

    const withCookie = identifyDevice(request(headers));
    for (let i = 0; i < TRIAL_LIMIT; i++) await consumeQuota(withCookie, "shared", store);

    // Same network and browser, brand new cookie: the id differs, the
    // fingerprint does not, and the allowance is still gone.
    const cleared = identifyDevice(request(headers));
    expect(cleared.deviceId).not.toBe(withCookie.deviceId);
    expect((await consumeQuota(cleared, "shared", store)).granted).toBe(false);
  });

  it("peeking does not spend an allowance", async () => {
    const store = new MemoryUsageStore();
    const device = identifyDevice(request());
    await peekQuota(device, "shared", store);
    await peekQuota(device, "shared", store);
    expect((await peekQuota(device, "shared", store)).used).toBe(0);
  });
});

describe("bring your own key", () => {
  it("is never metered", async () => {
    const store = new MemoryUsageStore();
    const device = identifyDevice(request());
    for (let i = 0; i < TRIAL_LIMIT * 3; i++) {
      const { granted, state } = await consumeQuota(device, "byok", store);
      expect(granted).toBe(true);
      expect(state.limit).toBeNull();
    }
    // and it leaves the shared allowance untouched
    expect((await peekQuota(device, "shared", store)).used).toBe(0);
  });
});
