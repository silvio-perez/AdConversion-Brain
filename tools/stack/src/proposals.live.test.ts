// The full governed loop against real Forgejo: an agent proposes, a human
// approves and merges, the Brain picks it up, and the audit log records it.
import { describe, expect, it } from "vitest";
import { FORGEJO_URL, loadLocalEnv, ORG } from "./env.ts";
import { forgejo } from "./forgejo.ts";
import { brainCli, createToken, gatewayEnv, mcpCall } from "./live.ts";

const live = process.env.BRAIN_STACK === "1";
const env = live ? loadLocalEnv() : {};
const alice = forgejo({ username: "alice.synthetic", password: env.SYNTHETIC_USER_PASSWORD ?? "" });
const ACME = "client-acme-analytics";
const repo = `/repos/${ORG}/${ACME}`;

/** Act as the brain-proposer bot, with its real token. */
async function asBot(method: string, path: string, body?: unknown) {
  const res = await fetch(`${FORGEJO_URL}/api/v1${path}`, {
    method,
    headers: {
      authorization: `token ${gatewayEnv().FORGEJO_PROPOSER_TOKEN}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return res.status;
}

const doc = (slug: string) => `---
title: Live test learning ${slug}
type: learning
client: acme-analytics
owner: alice.synthetic
status: draft
last_reviewed: 2026-11-26
sources:
  - kind: grain
    ref: synthetic-meeting-live
---

# Live test ${slug}

Proposed by an agent during the live governance test.
`;

describe.skipIf(!live)("governed changes (live stack)", () => {
  it("a token can't propose where its owner can't (Alice is read-only on company)", () => {
    const res = brainCli(
      "token",
      "create",
      "--owner",
      "alice.synthetic",
      "--harness",
      "claude-code",
      "--sources",
      "company",
      "--mode",
      "propose",
    );
    expect(res.ok).toBe(false);
    expect(res.out).toContain("cannot propose changes to company");
  });

  it("propose -> human approves -> merge -> Brain serves it -> audit records it", async () => {
    const token = createToken("alice.synthetic", "gemini-cli", ACME, "propose");
    const slug = `live-${Date.now()}`;
    const path = `learnings/${slug}.md`;

    // 1. Agent proposes a new document.
    const proposed = await mcpCall(token, "propose_document", {
      source: ACME,
      path,
      content: doc(slug),
      summary: "Record a learning from the live governance test.",
      evidence: [{ kind: "grain", ref: "synthetic-meeting-live", at: "00:01:00" }],
    });
    expect(proposed.isError, proposed.text).toBe(false);
    const prNumber = Number(String(proposed.json().reviewUrl).split("/").pop());

    // 2. In Forgejo it is an open pull request by the bot, not a change to main.
    const pr = await alice("GET", `${repo}/pulls/${prNumber}`);
    expect(pr.json).toMatchObject({
      state: "open",
      merged: false,
      user: { login: "brain-proposer" },
    });
    expect((pr.json as { body: string }).body).toContain("gemini-cli, google");
    expect((await alice("GET", `${repo}/raw/${path}`)).status).toBe(404);

    // 3. The bot can neither merge its own proposal nor write to main.
    expect(
      await asBot("POST", `${repo}/pulls/${prNumber}/merge`, { Do: "merge" }),
    ).toBeGreaterThanOrEqual(400);
    expect(
      await asBot("POST", `${repo}/contents/learnings/bot-direct.md`, {
        content: Buffer.from("x").toString("base64"),
        message: "direct",
        branch: "main",
      }),
    ).toBeGreaterThanOrEqual(400);

    // 4. A human in the Acme pod approves and merges.
    expect(
      (
        await alice("POST", `${repo}/pulls/${prNumber}/reviews`, {
          event: "APPROVED",
          body: "Matches the call.",
        })
      ).status,
    ).toBe(200);
    const merged = await alice("POST", `${repo}/pulls/${prNumber}/merge`, { Do: "merge" });
    expect(merged.status, JSON.stringify(merged.json)).toBe(200);

    // 5. The Brain picks up the change and records the human decisions.
    expect(brainCli("reindex").ok).toBe(true);
    expect(brainCli("reconcile").ok).toBe(true);
    const read = await mcpCall(token, "read_document", { source: ACME, path });
    expect(read.isError).toBe(false);
    expect(read.text).toContain("live governance test");

    const proposals = (
      await mcpCall(token, "list_proposals", { source: ACME })
    ).json() as unknown as {
      path: string;
      state: string;
      approvedBy: string;
      decidedBy: string;
    }[];
    expect(proposals.find((p) => p.path === path)).toMatchObject({
      state: "merged",
      approvedBy: "alice.synthetic",
      decidedBy: "alice.synthetic",
    });
  });

  it("an update with an outdated revision is refused", async () => {
    const token = createToken("alice.synthetic", "claude-code", ACME, "propose");
    const res = await mcpCall(token, "propose_change", {
      source: ACME,
      path: "strategy.md",
      base_revision: "0000000000000000000000000000000000000000",
      content: doc("stale").replace("type: learning", "type: strategy"),
      summary: "This should be refused as stale.",
      evidence: [],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("changed since you read it");
  });

  it("a bot's approval does not count: only the client's own team can approve", async () => {
    const branch = `human-${Date.now()}`;
    const write = await alice("POST", `${repo}/contents/learnings/${branch}.md`, {
      content: Buffer.from(doc(branch)).toString("base64"),
      message: "Human proposal",
      branch: "main",
      new_branch: branch,
    });
    expect(write.status).toBe(201);
    const pr = await alice("POST", `${repo}/pulls`, {
      base: "main",
      head: branch,
      title: "Human proposal",
    });
    const n = (pr.json as { number: number }).number;

    // The bot has write access, so Forgejo lets it submit an approval...
    expect(
      await asBot("POST", `${repo}/pulls/${n}/reviews`, { event: "APPROVED", body: "lgtm" }),
    ).toBe(200);
    // ...but it isn't on the approvers list, so the merge is still blocked.
    const merge = await alice("POST", `${repo}/pulls/${n}/merge`, { Do: "merge" });
    expect(merge.status).toBeGreaterThanOrEqual(400);

    await alice("PATCH", `${repo}/pulls/${n}`, { state: "closed" });
    await alice("DELETE", `${repo}/branches/${branch}`);
  });
});
