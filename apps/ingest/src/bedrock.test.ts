import { describe, expect, it } from "vitest";
import { BedrockModel, type ConverseFn, extractJson } from "./bedrock.ts";
import type { Meeting } from "./grain.ts";

const meeting: Meeting = {
  id: "m",
  title: "t",
  startedAt: "2026-11-20T00:00:00Z",
  participants: [],
  segments: [],
};

describe("Bedrock adapter (no network: the AWS call is stubbed)", () => {
  it("refuses non-Anthropic models so the vendor policy stays honest", () => {
    expect(() => new BedrockModel({ modelId: "meta.llama3-70b-instruct-v1:0" })).toThrow(
      /only supports Anthropic/,
    );
    expect(
      () => new BedrockModel({ modelId: "us.anthropic.claude-x", converse: async () => ({}) }),
    ).not.toThrow();
  });

  it("sends the prompt as data with deterministic settings, and parses the JSON reply", async () => {
    let sent: Parameters<ConverseFn>[0] | undefined;
    const model = new BedrockModel({
      modelId: "anthropic.claude-test",
      converse: async (input) => {
        sent = input;
        return {
          output: { message: { content: [{ text: 'Sure!\n```json\n{"learnings": []}\n```' }] } },
          usage: { inputTokens: 1200, outputTokens: 40 },
        };
      },
    });
    const out = await model.extract({ prompt: "PROMPT", meeting, clientContext: "" });
    expect(out).toEqual({ learnings: [] });
    expect(sent?.inferenceConfig?.temperature).toBe(0);
    expect(sent?.messages?.[0]?.content?.[0]).toEqual({ text: "PROMPT" });
    expect(model.usage).toEqual({ inputTokens: 1200, outputTokens: 40, calls: 1 });
  });

  it("returns null for replies without valid JSON (the pipeline then rejects them)", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("{ broken")).toBeNull();
  });
});
