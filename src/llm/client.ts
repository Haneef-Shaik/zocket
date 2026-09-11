/**
 * Azure OpenAI client + the one structured-output call the agent makes.
 *
 * The planner and narrator both go through `structured()`, so there is exactly
 * one place where a model response becomes a typed object, and exactly one
 * place that has to be right about strict-schema handling.
 */

import { AzureOpenAI } from "openai/azure";
import { zodResponseFormat, zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import type { ResolvedLlmConfig } from "@/llm/config";

type TokenParam = "max_tokens" | "max_completion_tokens";

/**
 * Reasoning tokens count against this, so it is a ceiling rather than a target
 * and being generous costs nothing when it is not reached.
 */
const DEFAULT_TOKEN_CEILING = 4000;

/**
 * Which token-ceiling parameter each deployment accepts.
 *
 * Azure deployment names are chosen by whoever created the deployment, so there
 * is no reliable way to know up front whether one is a newer model (which
 * requires `max_completion_tokens`) or an older one (which only accepts the
 * deprecated `max_tokens`). Guessing from the name would be guessing.
 *
 * The provider's own 400 says exactly which parameter it wants, so we try the
 * current standard, flip on that specific error, and remember the answer: at
 * most one wasted call per deployment per process, and no configuration for
 * anyone bringing their own key.
 */
const tokenParams = new Map<string, TokenParam>();

/** A 400 that is specifically about the token-ceiling parameter, not anything else. */
function namesTokenParameter(err: unknown): boolean {
  if ((err as { status?: number })?.status !== 400) return false;
  const message = providerMessage(err);
  return (
    /max_tokens|max_completion_tokens/.test(message) &&
    /unsupported|not supported|unrecognized|invalid/i.test(message)
  );
}

/** Clients are cheap, but one per credential set avoids re-handshaking. */
const clients = new Map<string, AzureOpenAI>();

function clientFor(config: ResolvedLlmConfig): AzureOpenAI {
  // The cache key includes the key itself so two callers with different keys
  // can never share a client. It is a Map key in memory, never logged.
  const cacheKey = `${config.endpoint}|${config.apiVersion}|${config.apiKey}`;
  let client = clients.get(cacheKey);
  if (!client) {
    client = new AzureOpenAI({
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      apiVersion: config.apiVersion,
      maxRetries: 2,
      timeout: 60_000,
    });
    clients.set(cacheKey, client);
  }
  return client;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface StructuredRequest<T extends z.ZodType> {
  readonly config: ResolvedLlmConfig;
  readonly system: string;
  readonly user: string;
  /**
   * Must be a zod OBJECT at the root. OpenAI strict schemas reject a root-level
   * union, so a discriminated union has to be wrapped in an envelope --
   * see src/plan/wire.ts.
   */
  readonly schema: T;
  readonly schemaName: string;
  readonly maxTokens?: number;
}

/**
 * One model call returning a schema-validated object.
 *
 * Structured outputs are the reason the compiler never has to defend itself
 * against a malformed plan: a response that does not match the schema is a
 * failed request, not a bad plan that reaches the SQL layer.
 */
export async function structured<T extends z.ZodType>(
  req: StructuredRequest<T>,
): Promise<z.infer<T>> {
  const { config, schema, schemaName } = req;
  const client = clientFor(config);

  try {
    if (config.model.api === "responses") {
      const response = await client.responses.parse({
        model: config.model.deployment,
        input: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        text: { format: zodTextFormat(schema, schemaName) },
        max_output_tokens: req.maxTokens ?? 2000,
      });
      if (response.output_parsed == null) {
        throw new LlmError(`Model returned no parseable ${schemaName}.`);
      }
      return response.output_parsed as z.infer<T>;
    }

    const deployment = config.model.deployment;
    const ceiling = req.maxTokens ?? DEFAULT_TOKEN_CEILING;

    const callChat = (tokenParam: TokenParam) =>
      client.chat.completions.parse({
        model: deployment,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        response_format: zodResponseFormat(schema, schemaName),
        ...(tokenParam === "max_tokens"
          ? { max_tokens: ceiling }
          : { max_completion_tokens: ceiling }),
      });

    const preferred = tokenParams.get(deployment) ?? "max_completion_tokens";
    let completion;
    try {
      completion = await callChat(preferred);
      tokenParams.set(deployment, preferred);
    } catch (err) {
      if (!namesTokenParameter(err)) throw err;
      const flipped: TokenParam =
        preferred === "max_tokens" ? "max_completion_tokens" : "max_tokens";
      completion = await callChat(flipped);
      tokenParams.set(deployment, flipped);
    }

    const choice = completion.choices[0];
    const message = choice?.message;
    if (message?.refusal) {
      throw new LlmError(`Model refused the request: ${message.refusal}`);
    }
    if (message?.parsed == null) {
      // A reasoning model can spend the whole ceiling thinking and return
      // nothing, which is a different problem from a malformed response and
      // has a different fix.
      if (choice?.finish_reason === "length") {
        throw new LlmError(
          `The model reached its ${ceiling}-token ceiling before finishing the ` +
            `${schemaName}. If this deployment is a reasoning model, its thinking ` +
            `counts against that ceiling -- raise it.`,
        );
      }
      throw new LlmError(`Model returned no parseable ${schemaName}.`);
    }
    return message.parsed as z.infer<T>;
  } catch (err) {
    throw toLlmError(err, config);
  }
}

/**
 * The provider's own explanation, which is server-authored text and safe to
 * show. The request body -- which holds the key -- never comes near this.
 */
function providerMessage(err: unknown): string {
  const nested = (err as { error?: { message?: string } })?.error?.message;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  const message = err instanceof Error ? err.message : "";
  return message.trim();
}

const suffix = (detail: string) => (detail ? ` Provider said: "${detail}".` : "");

/**
 * Turn provider errors into something a user can act on, without leaking the
 * request body (which contains the key) into a message or a log.
 */
function toLlmError(err: unknown, config: ResolvedLlmConfig): LlmError {
  if (err instanceof LlmError) return err;

  const status = (err as { status?: number })?.status;
  const whose = config.mode === "byok" ? "your" : "the server's";
  const detail = providerMessage(err);

  switch (status) {
    case 401:
      return new LlmError(`Azure OpenAI rejected ${whose} API key.${suffix(detail)}`, status);

    case 403:
      // A 403 is usually *not* a bad key. Azure returns it for network ACLs on
      // the resource, and "rejected your API key" sends whoever reads it
      // hunting for the wrong problem entirely -- a new key will not help if
      // the caller's IP is not on the allow-list.
      if (/virtual network|firewall|ip.{0,10}(rule|address)/i.test(detail)) {
        return new LlmError(
          `Azure OpenAI refused the request at the network layer: "${detail}". ` +
            `The key is not the problem — the resource at ${config.endpoint} has ` +
            `Virtual Network / firewall rules that do not include this caller's IP. ` +
            `Add the IP to the resource's networking allow-list, or use a key for a ` +
            `resource that accepts public network access.`,
          403,
        );
      }
      return new LlmError(
        `Azure OpenAI denied access with ${whose} API key.${suffix(detail)}`,
        403,
      );
    case 404:
      return new LlmError(
        `Deployment "${config.model.deployment}" was not found at ${config.endpoint}. ` +
          `Azure deployment names are chosen when you create the deployment and are ` +
          `often not the same as the model name.`,
        404,
      );
    case 429:
      return new LlmError("Azure OpenAI rate limit reached. Try again shortly.", 429);
    default: {
      const message = err instanceof Error ? err.message : "unknown error";
      return new LlmError(`Azure OpenAI request failed: ${message}`, status);
    }
  }
}
