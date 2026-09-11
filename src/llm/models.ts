/**
 * The model registry.
 *
 * Two separate concerns, deliberately not merged:
 *
 *   * With OUR key, the caller may only pick from `SHARED_MODELS`. An open
 *     `deployment` field on a shared key is an invitation to bill us on the
 *     most expensive deployment in the resource.
 *   * With the caller's OWN key, any deployment name is allowed -- they know
 *     their resource better than this file does, and they are paying.
 */

export type ApiSurface = "chat" | "responses";

export interface ModelDef {
  /** Stable id used on the wire and in the trace. */
  readonly id: string;
  /** Azure deployment name. Often equal to `id`, but not necessarily. */
  readonly deployment: string;
  readonly label: string;
  /**
   * Which Azure surface this deployment answers on. Newer reasoning models are
   * Responses-only; most deployments accept chat completions.
   */
  readonly api: ApiSurface;
  /** Set false for deployments that reject `response_format: json_schema`. */
  readonly structuredOutputs: boolean;
}

export const DEFAULT_MODEL_ID = "gpt6-sol";

export const SHARED_MODELS: Readonly<Record<string, ModelDef>> = {
  "gpt6-sol": {
    id: "gpt6-sol",
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt6-sol",
    label: "GPT-6 Sol",
    api: "chat",
    structuredOutputs: true,
  },
  "gpt-4o": {
    id: "gpt-4o",
    deployment: "gpt-4o",
    label: "GPT-4o",
    api: "chat",
    structuredOutputs: true,
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    deployment: "gpt-4o-mini",
    label: "GPT-4o mini",
    api: "chat",
    structuredOutputs: true,
  },
} as const;

export function listSharedModels(): readonly ModelDef[] {
  return Object.values(SHARED_MODELS);
}

export function resolveSharedModel(id: string | undefined): ModelDef {
  const key = id ?? DEFAULT_MODEL_ID;
  const model = SHARED_MODELS[key];
  if (!model) {
    throw new ModelNotAllowedError(key, Object.keys(SHARED_MODELS));
  }
  return model;
}

/** A caller-supplied deployment, used only with a caller-supplied key. */
export function customModel(
  deployment: string,
  api: ApiSurface = "chat",
): ModelDef {
  return {
    id: deployment,
    deployment,
    label: deployment,
    api,
    structuredOutputs: true,
  };
}

export class ModelNotAllowedError extends Error {
  constructor(
    readonly requested: string,
    readonly allowed: readonly string[],
  ) {
    super(
      `Model "${requested}" is not available on the shared key. ` +
        `Choose one of: ${allowed.join(", ")} -- or supply your own API key to use any deployment.`,
    );
    this.name = "ModelNotAllowedError";
  }
}
