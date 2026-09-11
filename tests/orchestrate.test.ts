/**
 * The loop, end to end, with the two model calls stubbed.
 *
 * Stubbing them is the point rather than a compromise: it lets the assertions
 * be about the parts that must never depend on a model -- that a refusal never
 * invents a figure, that a narrator which does invent one cannot ship it, and
 * that losing the narrator entirely costs prose and not numbers.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { PlanSchema } from "@/plan/schema";
import type { ResolvedLlmConfig } from "@/llm/config";

const stub = vi.hoisted(() => ({
  plan: null as unknown,
  findings: [] as string[],
  planCalls: 0,
  findingCalls: 0,
}));

vi.mock("@/llm/client", () => ({
  LlmError: class LlmError extends Error {},
  structured: vi.fn(async (req: { schemaName: string }) => {
    if (req.schemaName === "plan") {
      stub.planCalls++;
      return { plan: stub.plan };
    }
    stub.findingCalls++;
    const next = stub.findings.shift();
    if (next === undefined) throw new Error("provider unavailable");
    return { finding: next };
  }),
}));

const { ask } = await import("@/agent/orchestrate");

const CONFIG: ResolvedLlmConfig = {
  apiKey: "not-used",
  endpoint: "https://example.invalid",
  apiVersion: "2024-10-21",
  model: { id: "test", deployment: "test", label: "test", api: "chat", structuredOutputs: true },
  mode: "shared",
};

/** Parsed the way the real structured() would, so defaults are applied. */
function setPlan(raw: unknown) {
  stub.plan = PlanSchema.parse(raw);
}

const Q1 = {
  plan_type: "breakdown",
  interpretation: "Spend by channel over the last eight weeks",
  filters: [],
  metrics: ["spend_usd"],
  dimensions: ["channel"],
  time_range: { type: "relative", n: 8, unit: "week", calendar: false, offset: 0 },
};

beforeEach(() => {
  stub.findings = [];
  stub.planCalls = 0;
  stub.findingCalls = 0;
});

describe("the answered path", () => {
  it("assembles plan, SQL, rows, flags, chart and trace", async () => {
    setPlan(Q1);
    stub.findings = ["Meta led on spend at $162,490, ahead of YouTube at $98,384."];

    const answer = await ask("What did we spend by channel over the last eight weeks?", CONFIG);

    expect(answer.status).toBe("answered");
    expect(answer.finding).toContain("162,490");
    expect(answer.sql).toContain("GROUP BY");
    expect(answer.result?.rows.length).toBe(5);
    expect(answer.chart?.kind).toBe("bar");
    expect(answer.flags.map((f) => f.code)).toContain("partial_day");
    expect(answer.trace.traceId).toMatch(/^t_/);
    expect(answer.trace.latencyMs.total).toBeGreaterThanOrEqual(0);

    // The interpretation is the model's line plus the dates code resolved.
    expect(answer.interpretation).toContain("11 Jul 2026");
    expect(answer.interpretation).toContain("4 Sep 2026");
  });
});

describe("the refusal path never reaches a model", () => {
  it("q5: composes the refusal and produces no competitor figure", async () => {
    setPlan({
      plan_type: "unanswerable",
      interpretation: "Competitor spend is not in this dataset",
      filters: [],
      reason: "no_such_entity",
      missing: "a competitor spend feed",
    });
    stub.findings = ["Competitors spent roughly $2.4m over the same period."];

    const answer = await ask("How does our spend compare to our competitors'?", CONFIG);

    expect(answer.status).toBe("refused");
    expect(answer.sql).toBeNull();
    expect(answer.result).toBeNull();
    expect(answer.chart).toBeNull();
    // The narrator was never called, so its fabrication cannot appear.
    expect(stub.findingCalls).toBe(0);
    expect(answer.finding).not.toContain("2.4m");
    expect(answer.finding).toContain("not in this dataset");
    // A refusal still says what it *can* do.
    expect(answer.finding.toLowerCase()).toContain("channel");
  });

  it("n5: a window outside coverage is refused rather than answered with zero", async () => {
    setPlan({
      plan_type: "breakdown",
      interpretation: "Spend by channel in May",
      filters: [],
      metrics: ["spend_usd"],
      dimensions: ["channel"],
      time_range: { type: "absolute", start: "2026-05-01", end: "2026-05-31" },
    });

    const answer = await ask("Show me May's spend by channel.", CONFIG);

    expect(answer.status).toBe("refused");
    // It may *mention* $0 to explain why it is not returning one; what it must
    // not do is hand back a result table with a zero in it.
    expect(answer.result).toBeNull();
    expect(answer.sql).toBeNull();
    expect(answer.finding).toContain("outside the data");
    expect(answer.finding).toContain("8 Jun 2026");
  });
});

describe("a narrator that invents a figure cannot ship it", () => {
  it("falls back to the template after the guard rejects it twice", async () => {
    setPlan(Q1);
    stub.findings = [
      "Meta led at $999,999,999 across the period.",
      "On reflection Meta led at $888,888,888.",
    ];

    const answer = await ask("What did we spend by channel?", CONFIG);

    expect(stub.findingCalls).toBe(2); // one attempt, one correction
    expect(answer.status).toBe("answered");
    expect(answer.finding).not.toContain("999,999,999");
    expect(answer.finding).not.toContain("888,888,888");
    // The numbers are still right, because they were never the model's.
    expect(answer.finding).toContain("162,490");
    expect(answer.result?.rows.length).toBe(5);
  });

  it("accepts a corrected second attempt", async () => {
    setPlan(Q1);
    stub.findings = [
      "Meta led at $999,999,999.",
      "Meta led on spend at $162,490.",
    ];

    const answer = await ask("What did we spend by channel?", CONFIG);
    expect(stub.findingCalls).toBe(2);
    expect(answer.finding).toBe("Meta led on spend at $162,490.");
  });
});

describe("losing the narrator costs prose, not numbers", () => {
  it("degrades to the template when the provider is unavailable", async () => {
    setPlan(Q1);
    stub.findings = []; // the stub throws when it runs out

    const answer = await ask("What did we spend by channel?", CONFIG);

    expect(answer.status).toBe("answered");
    expect(answer.finding.length).toBeGreaterThan(20);
    expect(answer.result?.rows.length).toBe(5);
    expect(answer.sql).toContain("SUM(spend_usd)");
  });
});
