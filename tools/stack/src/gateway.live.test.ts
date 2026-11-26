// Live gateway tests against a seeded stack with `pnpm gateway` running.
// Exercises the real path: Forgejo -> read-only gateway account -> index -> MCP.
import { describe, expect, it } from "vitest";
import { brainCli as brain, createToken, mcpCall } from "./live.ts";

const live = process.env.BRAIN_STACK === "1";
const CANARY = "GLOBEX-CANARY-7f3a";

describe.skipIf(!live)("gateway (live stack)", () => {
  it("refuses a token wider than its owner's own Forgejo access", () => {
    const res = brain(
      "token",
      "create",
      "--owner",
      "alice.synthetic",
      "--harness",
      "claude-code",
      "--sources",
      "client-globex-cloud",
    );
    expect(res.ok).toBe(false);
    expect(res.out).toContain("cannot read client-globex-cloud");
  });

  it("refuses a token for a vendor not approved for that client", () => {
    const res = brain(
      "token",
      "create",
      "--owner",
      "bob.synthetic",
      "--harness",
      "codex-cli",
      "--sources",
      "client-globex-cloud",
    );
    expect(res.ok).toBe(false);
    expect(res.out).toContain("not an approved vendor");
  });

  it("serves the owner's knowledge from Forgejo and nothing else", async () => {
    const token = createToken(
      "alice.synthetic",
      "codex-cli",
      "company,skills,client-acme-analytics",
    );
    const hit = await mcpCall(token, "search", { query: "customer quotes" });
    expect(hit.text).toContain("learnings/2026-10-creative-test.md");

    for (const [tool, args] of [
      ["list_sources", {}],
      ["search", { query: "Globex canary GLOBEX-CANARY-7f3a embargoed" }],
      ["list_documents", { source: "client-globex-cloud" }],
      ["read_document", { source: "client-globex-cloud", path: "business-context.md" }],
    ] as const) {
      const r = await mcpCall(token, tool, args);
      expect(r.text, tool).not.toContain(CANARY);
      expect(r.text, tool).not.toMatch(/globex/i);
    }
  });

  it("gives Globex's own pod (approved vendor) access", async () => {
    const token = createToken("bob.synthetic", "claude-code", "client-globex-cloud");
    const doc = await mcpCall(token, "read_document", {
      source: "client-globex-cloud",
      path: "business-context.md",
    });
    expect(doc.isError).toBe(false);
    expect(doc.text).toContain(CANARY);
  });
});
