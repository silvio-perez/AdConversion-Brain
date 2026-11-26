import { beforeAll, describe, expect, it } from "vitest";
import { MAX_PROPOSALS_PER_HOUR } from "./brain.ts";
import { PROPOSE_TOOLS, READ_TOOLS } from "./mcp.ts";
import { checkPath } from "./proposals.ts";
import { ACME, CANARY, GLOBEX, makeGateway, toolText } from "./testkit.ts";

type GW = Awaited<ReturnType<typeof makeGateway>>;
let gw: GW;
let reader: string;
let proposer: string;

const LEARNING = `---
title: November webinar test
type: learning
client: acme-analytics
owner: alice.synthetic
status: draft
last_reviewed: 2026-11-26
sources:
  - kind: grain
    ref: synthetic-meeting-0004
---

# November webinar test

Webinar registrants converted to opportunities at twice the rate of report downloads.
`;
const EVIDENCE = [{ kind: "grain", ref: "synthetic-meeting-0004", at: "00:14:20" }];

beforeAll(async () => {
  gw = await makeGateway();
  reader = gw.token();
  proposer = gw.token({ mode: "propose", name: "alice-proposer" });
});

async function post(tok: string, source: string, body: Record<string, unknown>) {
  const res = await gw.app.request(`/v1/sources/${source}/proposals`, {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function readDoc(tok: string, source: string, path: string) {
  return (await gw.get(`/v1/sources/${source}/documents/${path}`, tok)).json as {
    revision: string;
    body: string;
  };
}

describe("who may propose (SEC-INT-1)", () => {
  it("read-only tokens don't see propose tools and are refused over REST", async () => {
    const client = await gw.mcp(reader);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.sort()).toEqual([...READ_TOOLS].sort());
    await client.close();
    const res = await post(reader, ACME, {
      path: "learnings/x.md",
      content: LEARNING,
      summary: "Should be refused",
    });
    expect(res.status).toBe(403);
    expect(gw.writer.opened).toHaveLength(0);
  });

  it("propose tokens get the extra tools, marked as non-read-only", async () => {
    const client = await gw.mcp(proposer);
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS, ...PROPOSE_TOOLS].sort());
    for (const t of tools.filter((t) => (PROPOSE_TOOLS as readonly string[]).includes(t.name)))
      expect(t.annotations?.readOnlyHint).toBe(false);
    await client.close();
  });
});

describe("opening proposals", () => {
  it("a new document becomes a pull request with evidence, never a direct write", async () => {
    const client = await gw.mcp(proposer);
    const result = await client.callTool({
      name: "propose_document",
      arguments: {
        source: ACME,
        path: "learnings/2026-11-webinar-test.md",
        content: LEARNING,
        summary: "Record the November webinar test result from the weekly sync.",
        evidence: EVIDENCE,
      },
    });
    expect(result.isError).toBeFalsy();
    expect(toolText(result)).toContain("A human reviewer must approve it");
    await client.close();

    const pr = gw.writer.opened.at(-1);
    expect(pr).toMatchObject({
      source: ACME,
      path: "learnings/2026-11-webinar-test.md",
      baseRevision: null,
    });
    expect(pr?.branch).toMatch(
      /^proposal\/alice-synthetic\/\d{8}-learnings-2026-11-webinar-test-[0-9a-f]{4}$/,
    );
    expect(pr?.body).toContain("synthetic-meeting-0004");
    expect(pr?.body).toContain("@alice.synthetic");
    expect(pr?.body).toContain("claude-code, anthropic");
    expect(pr?.body).toContain("Nothing from another client appears");
    // The canonical document set is unchanged until a human merges.
    expect(
      (await gw.get(`/v1/sources/${ACME}/documents/learnings/2026-11-webinar-test.md`, proposer))
        .status,
    ).toBe(404);
  });

  it("an update must carry the revision that was read", async () => {
    const doc = await readDoc(proposer, ACME, "strategy.md");
    const updated = (await gw.get(`/v1/sources/${ACME}/documents/strategy.md`, proposer)).text;
    const content = `---\n${Object.entries(
      JSON.parse(updated).frontmatter as Record<string, unknown>,
    )
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n")}\n---\n${doc.body.replace("40 sales-qualified", "45 sales-qualified")}`;
    const ok = await post(proposer, ACME, {
      path: "strategy.md",
      base_revision: doc.revision,
      content,
      summary: "Raise the quarterly opportunity target from 40 to 45 as agreed.",
      evidence: EVIDENCE,
    });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(gw.writer.opened.at(-1)?.baseRevision).toBe(doc.revision);
  });

  it("refuses a stale revision (someone changed the document since it was read)", async () => {
    const doc = await readDoc(proposer, ACME, "brand-guidelines.md");
    gw.writer.files.set(`${ACME}/brand-guidelines.md`, {
      revision: "changed-by-someone-else",
      content: "",
    });
    const before = gw.writer.opened.length;
    const res = await post(proposer, ACME, {
      path: "brand-guidelines.md",
      base_revision: doc.revision,
      content: LEARNING.replace("type: learning", "type: brand-guidelines"),
      summary: "Tweak the voice section.",
    });
    expect(res.status).toBe(409);
    expect(String(res.json.error)).toContain("Read it again");
    expect(gw.writer.opened.length).toBe(before);
  });

  it("refuses to create a document that already exists", async () => {
    const res = await post(proposer, ACME, {
      path: "strategy.md",
      content: LEARNING.replace("type: learning", "type: strategy"),
      summary: "Overwrite strategy blindly.",
    });
    expect(res.status).toBe(422);
  });
});

describe("validation", () => {
  it.each([
    ["../client-globex-cloud/strategy.md"],
    ["/etc/passwd.md"],
    [".github/workflows/x.md"],
    ["learnings/Upper.md"],
    ["learnings/notes.txt"],
    ["learnings/./x.md"],
  ])("rejects unsafe path %s", (path) => {
    expect(checkPath(path)).not.toBeNull();
  });

  it("rejects documents that break the knowledge conventions", async () => {
    const wrongClient = LEARNING.replace("client: acme-analytics", "client: globex-cloud");
    const res = await post(proposer, ACME, {
      path: "learnings/misfiled.md",
      content: wrongClient,
      summary: "A document that claims to belong to another client.",
    });
    expect(res.status).toBe(422);
    expect((res.json.problems as string[]).join("\n")).toContain('client must be "acme-analytics"');
  });

  it("requires a real summary", async () => {
    const res = await post(proposer, ACME, {
      path: "learnings/a.md",
      content: LEARNING,
      summary: "fix",
    });
    expect(res.status).toBe(422);
  });
});

describe("isolation for proposals (SEC-ISO-4)", () => {
  it("cannot propose into another client, and gets the standard 404", async () => {
    const before = gw.writer.opened.length;
    const res = await post(proposer, GLOBEX, {
      path: "learnings/x.md",
      content: LEARNING.replace("acme-analytics", "globex-cloud"),
      summary: "Attempt to write into another client.",
    });
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: "Not found" });
    expect(gw.writer.opened.length).toBe(before);
  });

  it("list_proposals never shows another client's proposals", async () => {
    const bob = gw.token({ owner: "bob.synthetic", mode: "propose", sources: [GLOBEX] });
    const globexDoc = LEARNING.replace("acme-analytics", "globex-cloud").replace("alice", "bob");
    expect(
      (
        await post(bob, GLOBEX, {
          path: "learnings/canary.md",
          content: `${globexDoc}\n${CANARY}\n`,
          summary: "Globex-only learning for the pod.",
        })
      ).status,
    ).toBe(200);

    const client = await gw.mcp(proposer);
    const text = toolText(await client.callTool({ name: "list_proposals", arguments: {} }));
    expect(text).not.toMatch(/globex/i);
    expect(text).toContain("webinar-test");
    const denied = await client.callTool({ name: "list_proposals", arguments: { source: GLOBEX } });
    expect(denied.isError).toBe(true);
    await client.close();
  });

  it("vendor policy applies to proposals too", async () => {
    const codex = gw.token({
      owner: "bob.synthetic",
      harness: "codex-cli",
      vendor: "openai",
      mode: "propose",
      sources: [GLOBEX],
    });
    const res = await post(codex, GLOBEX, {
      path: "learnings/y.md",
      content: LEARNING,
      summary: "Codex should not reach Globex.",
    });
    expect(res.status).toBe(404);
  });
});

describe("rate limiting and audit", () => {
  it(`caps proposals at ${MAX_PROPOSALS_PER_HOUR} per token per hour`, async () => {
    const tok = gw.token({ mode: "propose", name: "runaway-agent" });
    let last = 0;
    for (let i = 0; i <= MAX_PROPOSALS_PER_HOUR; i++) {
      const res = await post(tok, ACME, {
        path: `learnings/flood-${i}.md`,
        content: LEARNING,
        summary: "Runaway agent proposing again and again.",
      });
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("records approvals, merges and rejections made in Forgejo", async () => {
    const opened = gw.writer.opened.filter((p) => p.path === "learnings/2026-11-webinar-test.md");
    const n = opened[0]?.number ?? 0;
    gw.writer.statuses.set(`${ACME}#${n}`, {
      state: "open",
      mergedBy: null,
      approvedBy: ["alice.synthetic"],
    });
    expect(await gw.brain.reconcile()).toBe(1);
    gw.writer.statuses.set(`${ACME}#${n}`, {
      state: "merged",
      mergedBy: "alice.synthetic",
      approvedBy: ["alice.synthetic"],
    });
    expect(await gw.brain.reconcile()).toBe(1);
    expect(await gw.brain.reconcile()).toBe(0); // idempotent

    const rows = gw.db
      .prepare(
        "SELECT action, owner, resource FROM audit WHERE action LIKE 'forgejo:%' ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      {
        action: "forgejo:proposal_approved",
        owner: "alice.synthetic",
        resource: `learnings/2026-11-webinar-test.md#${n}`,
      },
      {
        action: "forgejo:proposal_merged",
        owner: "alice.synthetic",
        resource: `learnings/2026-11-webinar-test.md#${n}`,
      },
    ]);
    const results = gw.db
      .prepare("SELECT DISTINCT result FROM audit WHERE action LIKE '%propose%'")
      .all();
    expect(results.map((r) => (r as { result: string }).result)).toEqual(
      expect.arrayContaining([
        "denied_read_only",
        "stale",
        "invalid",
        "exists",
        "denied",
        "rate_limited",
      ]),
    );
  });
});
