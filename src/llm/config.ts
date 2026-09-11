/**
 * Credential resolution: bring-your-own-key, or the shared trial key.
 *
 * Handling someone else's API key is the security-sensitive part of this
 * feature, so the rules are narrow and stated here rather than spread around:
 *
 *   * The key arrives in a POST body only -- never a query string, which ends
 *     up in access logs, browser history, and referrer headers.
 *   * It is never written to disk, never logged, never put in the trace, and
 *     never echoed back in a response.
 *   * It lives for the duration of one request. There is no server-side store.
 *   * The browser keeps it in localStorage and re-sends it per request, so the
 *     user can revoke it by clearing it and we hold nothing after the response.
 */

import { z } from "zod";
import {
  customModel,
  DEFAULT_MODEL_ID,
  resolveSharedModel,
  type ApiSurface,
  type ModelDef,
} from "@/llm/models";

/** Azure API version. Structured outputs need 2024-08-01-preview or later. */
export const DEFAULT_API_VERSION =
  process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21";

/**
 * What the client may send. Anything absent falls back to the shared trial
 * credentials, which is what consumes quota.
 */
export const CredentialsSchema = z.object({
  apiKey: z.string().min(1).max(512).optional(),
  endpoint: z.string().url().max(512).optional(),
  deployment: z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/).optional(),
  apiVersion: z.string().min(1).max(32).regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}(-preview)?$/).optional(),
  /** Only meaningful on the shared key; ignored when a custom deployment is given. */
  model: z.string().min(1).max(128).optional(),
  api: z.enum(["chat", "responses"]).optional(),
});

export type Credentials = z.infer<typeof CredentialsSchema>;

export interface ResolvedLlmConfig {
  readonly apiKey: string;
  readonly endpoint: string;
  readonly apiVersion: string;
  readonly model: ModelDef;
  /** "byok" does not consume quota; "shared" does. */
  readonly mode: "byok" | "shared";
}

export class MissingCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingCredentialsError";
  }
}

/**
 * A caller is "bring your own key" only if they supplied BOTH a key and an
 * endpoint. A key without an endpoint would silently fall through to our
 * resource and bill us while looking to the user like their own account.
 */
export function resolveLlmConfig(input: Credentials): ResolvedLlmConfig {
  const byok = Boolean(input.apiKey && input.endpoint);

  if (input.apiKey && !input.endpoint) {
    throw new MissingCredentialsError(
      "An `endpoint` is required alongside your own `apiKey` " +
        "(for example https://your-resource.openai.azure.com).",
    );
  }

  if (byok) {
    const model = input.deployment
      ? customModel(input.deployment, (input.api ?? "chat") as ApiSurface)
      : resolveSharedModel(input.model ?? DEFAULT_MODEL_ID);
    return {
      apiKey: input.apiKey!,
      endpoint: normalizeEndpoint(input.endpoint!),
      apiVersion: input.apiVersion ?? DEFAULT_API_VERSION,
      model,
      mode: "byok",
    };
  }

  const sharedKey = process.env.AZURE_OPENAI_API_KEY;
  const sharedEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (!sharedKey || !sharedEndpoint) {
    throw new MissingCredentialsError(
      "No shared Azure OpenAI credentials are configured on this server. " +
        "Supply your own `apiKey` and `endpoint`, or set AZURE_OPENAI_API_KEY " +
        "and AZURE_OPENAI_ENDPOINT.",
    );
  }

  // On the shared key the deployment is NOT caller-controlled.
  return {
    apiKey: sharedKey,
    endpoint: normalizeEndpoint(sharedEndpoint),
    apiVersion: input.apiVersion ?? DEFAULT_API_VERSION,
    model: resolveSharedModel(input.model),
    mode: "shared",
  };
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

/**
 * Strip anything credential-shaped before a value reaches a log line, a trace,
 * or an HTTP response body.
 */
export function redact(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = /key|secret|token|password|authorization/i.test(k) ? "[redacted]" : v;
  }
  return out;
}
