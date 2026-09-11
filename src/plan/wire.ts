/**
 * The wire schema for the planner.
 *
 * `PlanSchema` is a discriminated union, and OpenAI strict structured outputs
 * reject a union at the schema root ("Root schema must have type: 'object'").
 * Wrapping it in an envelope keeps the union nested, where it is allowed.
 *
 * Keeping this separate from the domain schema is not just a workaround -- the
 * shape a model must emit and the shape the compiler consumes are different
 * concerns, and the normalisation step below is where defaults get applied.
 */

import { z } from "zod";
import { PlanSchema, type Plan } from "@/plan/schema";

export const PlanEnvelopeSchema = z.object({
  plan: PlanSchema,
});

export type PlanEnvelope = z.infer<typeof PlanEnvelopeSchema>;

export function unwrapPlan(envelope: PlanEnvelope): Plan {
  return envelope.plan;
}
