import { beforeAll, describe, expect, it } from "vitest";
import { toFtsQuery } from "./brain.ts";
import { READ_TOOLS } from "./mcp.ts";
import { ACME, CANARY, GLOBEX, makeGateway, toolText } from "./testkit.ts";
import { createToken, revokeToken, verifyToken } from "./tokens.ts";

type GW = Awaited<ReturnType<typeof makeGateway>>;
let gw: GW;
let acme: string;
beforeAll(async () => {
  gw = await makeGateway();
  acme = gw.token();
});

describe("authentication (SEC-AUTH-4/5/6)", () => {
  it("rejects missing and invalid tokens", async () => {
    expect((await gw.get("/v1/sources")).status).toBe(401);
    expect((await gw.get("/v1/sources", "brn_nope")).status).toBe(401);
  });

  it("refuses tokens sent in the URL, even valid ones", async () => {
    for (const p of ["token", "key", "access_token"]) {
      const res = await gw.get(`/v1/sources?${p}=${acme}`);
      expect(res.status).toBe(400);
    }
  });

  it("rejects expired and revoked tokens", async () => {
    const past = new Date(Date.now() - 40 * 86_400_000);
    const { token: expired } = createToken(
      gw.db,
      {
        name: "old",
        owner: "a",
        harness: "h",
        vendor: "anthropic",
        sources: ["company"],
        days: 30,
      },
      past,
    );
    expect((await gw.get("/v1/whoami", expired)).status).toBe(401);

    const { token, record } = createToken(gw.db, {
      name: "rev",
      owner: "a",
      harness: "h",
      vendor: "anthropic",
      sources: ["company"],
      days: 1,
    });
    expect((await gw.get("/v1/whoami", token)).status).toBe(200);
    revokeToken(gw.db, record.id);
    expect((await gw.get("/v1/whoami", token)).status).toBe(401);
  });

  it("caps token lifetime at 90 days and requires a scope", () => {
    const base = { name: "x", owner: "a", harness: "h", vendor: "anthropic", sources: ["company"] };
    expect(() => createToken(gw.db, { ...base, days: 91 })).toThrow();
    expect(() => createToken(gw.db, { ...base, days: 30, sources: [] })).toThrow();
  });

  it("stores only a hash of the token", () => {
    const { token } = createToken(gw.db, {
      name: "h",
      owner: "a",
      harness: "h",
      vendor: "anthropic",
      sources: ["company"],
      days: 1,
    });
    const dump = JSON.stringify(gw.db.prepare("SELECT * FROM tokens").all());
    expect(dump).not.toContain(token);
    expect(verifyToken(gw.db, token)).not.toBeNull();
  });

  it("rate-limits repeated failed attempts", async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) {
      const res = await gw.app.request("/v1/sources", {
        headers: { authorization: "Bearer brn_wrong", "x-test-client": "attacker" },
      });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

describe("client isolation over REST (SEC-ISO-3/4)", () => {
  it("lists only in-scope sources", async () => {
    const res = await gw.get("/v1/sources", acme);
    const names = (res.json as { sources: { source: string }[] }).sources.map((s) => s.source);
    expect(names).toEqual(["client-acme-analytics", "company", "skills"]);
  });

  it("returns the same 404 for another client's data as for data that doesn't exist", async () => {
    const outOfScope = await gw.get(`/v1/sources/${GLOBEX}/documents/business-context.md`, acme);
    const missing = await gw.get(`/v1/sources/${ACME}/documents/nope.md`, acme);
    const fake = await gw.get("/v1/sources/client-does-not-exist/documents", acme);
    expect([outOfScope.status, missing.status, fake.status]).toEqual([404, 404, 404]);
    expect(outOfScope.text).toBe(missing.text);
    expect(outOfScope.text).toBe(fake.text);
  });

  it("cannot reach another client by path tricks", async () => {
    for (const path of [
      `/v1/sources/${ACME}/documents/..%2F${GLOBEX}%2Fbusiness-context.md`,
      `/v1/sources/${ACME}%2F..%2F${GLOBEX}/documents/business-context.md`,
      `/v1/sources/${GLOBEX.toUpperCase()}/documents/business-context.md`,
    ]) {
      const res = await gw.get(path, acme);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain(CANARY);
    }
  });

  it("never returns another client's content in search", async () => {
    for (const q of [
      "GLOBEX-CANARY-7f3a",
      "Globex",
      "infrastructure cost monitoring",
      "embargoed",
    ]) {
      const res = await gw.get(`/v1/search?q=${encodeURIComponent(q)}`, acme);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain(CANARY);
      expect(res.text).not.toMatch(/globex/i);
    }
    expect((await gw.get(`/v1/search?q=strategy&source=${GLOBEX}`, acme)).status).toBe(404);
  });

  it("still finds the caller's own knowledge", async () => {
    const res = await gw.get("/v1/search?q=customer%20quotes", acme);
    const hits = (res.json as { results: { source: string; path: string }[] }).results;
    expect(hits[0]).toMatchObject({ source: ACME, path: "learnings/2026-10-creative-test.md" });
  });

  it("treats search input as words, not query syntax", async () => {
    expect(toFtsQuery('NEAR("a" "b") OR source:x *')).toBe('"NEAR" "a" "b" "OR" "source" "x"');
    expect(
      (await gw.get(`/v1/search?q=${encodeURIComponent('") OR source:*')}`, acme)).status,
    ).toBe(200);
  });
});

describe("vendor policy (SEC-EGR-6, SEC-AUTH-7)", () => {
  it("hides a client from a vendor not approved for it, even if the token lists it", async () => {
    const codex = gw.token({
      owner: "bob.synthetic",
      harness: "codex-cli",
      vendor: "openai",
      sources: [GLOBEX, "company"],
    });
    const sources = ((await gw.get("/v1/sources", codex)).json as { sources: { source: string }[] })
      .sources;
    expect(sources.map((s) => s.source)).toEqual(["company"]);
    expect((await gw.get(`/v1/sources/${GLOBEX}/documents`, codex)).status).toBe(404);
    expect((await gw.get("/v1/search?q=Globex", codex)).text).not.toContain(CANARY);
  });

  it("allows the approved vendor", async () => {
    const claude = gw.token({ owner: "bob.synthetic", sources: [GLOBEX] });
    expect(
      (await gw.get(`/v1/sources/${GLOBEX}/documents/business-context.md`, claude)).text,
    ).toContain(CANARY);
  });

  it("rejects unknown vendors entirely", async () => {
    const unknown = gw.token({ vendor: "someone-else", sources: [ACME] });
    expect(((await gw.get("/v1/sources", unknown)).json as { sources: unknown[] }).sources).toEqual(
      [],
    );
  });
});

describe("MCP: any compliant harness (conformance + isolation)", () => {
  it("exposes the expected read-only tools", async () => {
    const client = await gw.mcp(acme);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS].sort());
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
    await client.close();
  });

  it("answers a question end to end: find, then read", async () => {
    const client = await gw.mcp(acme);
    const found = toolText(
      await client.callTool({ name: "search", arguments: { query: "creative test" } }),
    );
    expect(found).toContain("learnings/2026-10-creative-test.md");
    const doc = toolText(
      await client.callTool({
        name: "read_document",
        arguments: { source: ACME, path: "learnings/2026-10-creative-test.md" },
      }),
    );
    expect(doc).toContain("38%");
    expect(doc).toContain('"revision"');
    await client.close();
  });

  it("never leaks another client through any tool", async () => {
    const client = await gw.mcp(acme);
    const calls = [
      { name: "whoami", arguments: {} },
      { name: "list_sources", arguments: {} },
      { name: "list_documents", arguments: { source: GLOBEX } },
      { name: "read_document", arguments: { source: GLOBEX, path: "business-context.md" } },
      { name: "search", arguments: { query: "Globex canary GLOBEX-CANARY-7f3a" } },
      { name: "search", arguments: { query: "strategy", source: GLOBEX } },
    ];
    for (const call of calls) {
      const text = toolText(await client.callTool(call));
      expect(text, call.name).not.toContain(CANARY);
      expect(text, call.name).not.toMatch(/globex/i);
    }
    const denied = await client.callTool({
      name: "read_document",
      arguments: { source: GLOBEX, path: "business-context.md" },
    });
    expect(denied.isError).toBe(true);
    await client.close();
  });

  it("rejects MCP connections without a valid token", async () => {
    await expect(gw.mcp("brn_invalid")).rejects.toThrow();
  });
});

describe("audit log (SEC-AUD-1/2)", () => {
  it("records reads, denials and auth failures, without document content", async () => {
    const tok = gw.token({ owner: "audit.synthetic" });
    await gw.get(`/v1/sources/${ACME}/documents/strategy.md`, tok);
    await gw.get(`/v1/sources/${GLOBEX}/documents/business-context.md`, tok);
    const rows = gw.db
      .prepare("SELECT action, source, resource, result FROM audit WHERE owner = ? ORDER BY id")
      .all("audit.synthetic");
    expect(rows).toEqual([
      { action: "rest:read_document", source: ACME, resource: "strategy.md", result: "ok" },
      {
        action: "rest:read_document",
        source: GLOBEX,
        resource: "business-context.md",
        result: "denied",
      },
    ]);
    const all = JSON.stringify(gw.db.prepare("SELECT * FROM audit").all());
    expect(all).not.toContain("Target: 40 sales-qualified"); // body text never logged
    expect(all).toContain("missing_token");
  });

  it("cannot be edited or deleted", () => {
    expect(() => gw.db.exec("UPDATE audit SET result = 'ok'")).toThrow(/append-only/);
    expect(() => gw.db.exec("DELETE FROM audit")).toThrow(/append-only/);
  });
});
