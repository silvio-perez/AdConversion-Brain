import { describe, expect, it } from "vitest";
import { evaluate } from "./eval.ts";
import { LocalRuleModel } from "./model.ts";

describe("extraction evaluation set", () => {
  it("the local stand-in passes, so the bar is achievable and the harness works", async () => {
    const r = await evaluate(new LocalRuleModel({ vendor: "local" }));
    expect(r.violations).toBe(0);
    expect(r.recall).toBeGreaterThanOrEqual(0.8);
    expect(r.pass).toBe(true);
  });

  it("fails a model that invents evidence (nothing verifiable is kept)", async () => {
    const r = await evaluate(new LocalRuleModel({ vendor: "local", mode: "hallucinate" }));
    expect(r.pass).toBe(false);
    expect(r.recall).toBe(0);
  });
});
