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

describe.skipIf(!live)("nightly token recheck (live stack)", () => {
  it("revokes a token once its owner leaves the client's pod", async () => {
    const { loadLocalEnv, ORG } = await import("./env.ts");
    const { forgejo } = await import("./forgejo.ts");
    const e = loadLocalEnv();
    const admin = forgejo({
      username: e.FORGEJO_ADMIN_USER ?? "",
      password: e.FORGEJO_ADMIN_PASSWORD ?? "",
    });
    const teams = (await admin("GET", `/orgs/${ORG}/teams`)).json as { id: number; name: string }[];
    const pod = teams.find((t) => t.name === "pod-acme");
    if (!pod) throw new Error("pod-acme missing");

    const token = createToken("dave.synthetic", "claude-code", "client-acme-analytics");
    expect((await mcpCall(token, "whoami", {})).isError).toBe(false);

    await admin("DELETE", `/teams/${pod.id}/members/dave.synthetic`);
    try {
      const out = brain("token", "recheck");
      expect(out.out).toContain("can no longer read client-acme-analytics");
      const res = await fetch(`${process.env.BRAIN_URL ?? "http://localhost:8787"}/v1/whoami`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
    } finally {
      await admin("PUT", `/teams/${pod.id}/members/dave.synthetic`);
    }
  });
});
