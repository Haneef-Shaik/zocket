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

    const completion = await client.chat.completions.parse({
      model: config.model.deployment,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      response_format: zodResponseFormat(schema, schemaName),
      max_tokens: req.maxTokens ?? 2000,
    });

    const message = completion.choices[0]?.message;
    if (message?.refusal) {
      throw new LlmError(`Model refused the request: ${message.refusal}`);
    }
    if (message?.parsed == null) {
      throw new LlmError(`Model returned no parseable ${schemaName}.`);
    }
    return message.parsed as z.infer<T>;
  } catch (err) {
    throw toLlmError(err, config);
  }
}

/**
 * Turn provider errors into something a user can act on, without leaking the
 * request body (which contains the key) into a message or a log.
 */
function toLlmError(err: unknown, config: ResolvedLlmConfig): LlmError {
  if (err instanceof LlmError) return err;

  const status = (err as { status?: number })?.status;
  const whose = config.mode === "byok" ? "your" : "the server's";

  switch (status) {
    case 401:
    case 403:
      return new LlmError(`Azure OpenAI rejected ${whose} API key.`, status);
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
