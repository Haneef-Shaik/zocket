import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MissingCredentialsError, redact, resolveLlmConfig } from "@/llm/config";
import { ModelNotAllowedError } from "@/llm/models";

const SHARED = { key: "server-side-key", endpoint: "https://ours.openai.azure.com" };

beforeEach(() => {
  process.env.AZURE_OPENAI_API_KEY = SHARED.key;
  process.env.AZURE_OPENAI_ENDPOINT = SHARED.endpoint;
});

afterEach(() => {
  delete process.env.AZURE_OPENAI_API_KEY;
  delete process.env.AZURE_OPENAI_ENDPOINT;
});

describe("shared trial credentials", () => {
  it("falls back to the server key when the caller sends nothing", () => {
    const c = resolveLlmConfig({});
    expect(c.mode).toBe("shared");
    expect(c.apiKey).toBe(SHARED.key);
    expect(c.model.id).toBe("gpt6-sol");
  });

  it("lets the caller switch between allow-listed models", () => {
    expect(resolveLlmConfig({ model: "gpt-4o-mini" }).model.id).toBe("gpt-4o-mini");
  });

  it("refuses an arbitrary deployment on our key", () => {
    // Otherwise a caller picks the most expensive deployment in our resource
    // and bills us for it.
    expect(() => resolveLlmConfig({ model: "some-expensive-deployment" })).toThrow(
      ModelNotAllowedError,
    );
  });

  it("ignores a caller-supplied deployment when they are on our key", () => {
    const c = resolveLlmConfig({ deployment: "not-ours" });
    expect(c.mode).toBe("shared");
    expect(c.model.deployment).not.toBe("not-ours");
  });

  it("explains itself when no shared key is configured", () => {
    delete process.env.AZURE_OPENAI_API_KEY;
    expect(() => resolveLlmConfig({})).toThrow(MissingCredentialsError);
  });
});

describe("bring your own key", () => {
  const own = { apiKey: "caller-key", endpoint: "https://theirs.openai.azure.com" };

  it("uses the caller's credentials, not ours", () => {
    const c = resolveLlmConfig(own);
    expect(c.mode).toBe("byok");
    expect(c.apiKey).toBe("caller-key");
    expect(c.endpoint).toBe("https://theirs.openai.azure.com");
  });

  it("allows any deployment name", () => {
    expect(resolveLlmConfig({ ...own, deployment: "my-private-gpt6" }).model.deployment).toBe(
      "my-private-gpt6",
    );
  });

  it("rejects a key without an endpoint instead of silently using ours", () => {
    // The dangerous case: it would look like their account and bill ours.
    expect(() => resolveLlmConfig({ apiKey: "caller-key" })).toThrow(MissingCredentialsError);
  });

  it("normalises a trailing slash on the endpoint", () => {
    expect(resolveLlmConfig({ ...own, endpoint: `${own.endpoint}/` }).endpoint).toBe(own.endpoint);
  });
});

describe("redaction", () => {
  it("strips anything credential-shaped before it can reach a log or a trace", () => {
    const out = redact({ apiKey: "secret", Authorization: "Bearer x", model: "gpt6-sol" }) as Record<
      string,
      unknown
    >;
    expect(out.apiKey).toBe("[redacted]");
    expect(out.Authorization).toBe("[redacted]");
    expect(out.model).toBe("gpt6-sol");
  });
});
