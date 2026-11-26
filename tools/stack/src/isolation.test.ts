// Live-stack tests for client isolation (SEC-ISO-4) and change control
// (SEC-INT-1, SEC-INT-6). Run with `pnpm test:stack` against a seeded stack.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { FORGEJO_URL, loadLocalEnv, ORG } from "./env.ts";
import { basicAuth, forgejo } from "./forgejo.ts";

const live = process.env.BRAIN_STACK === "1";
const env = live ? loadLocalEnv() : {};
const password = env.SYNTHETIC_USER_PASSWORD ?? "";
const alice = forgejo({ username: "alice.synthetic", password });
const bob = forgejo({ username: "bob.synthetic", password });
const anon = forgejo(null);
const CANARY = "GLOBEX-CANARY-7f3a";

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe.skipIf(!live)("client isolation (live stack)", () => {
  it("anonymous users see nothing", async () => {
    for (const repo of ["company", "client-acme-analytics", "client-globex-cloud"]) {
      const res = await anon("GET", `/repos/${ORG}/${repo}`);
      expect([401, 403, 404]).toContain(res.status);
    }
  });

  it("Acme pod can read company knowledge and its own client", async () => {
    expect((await alice("GET", `/repos/${ORG}/company`)).status).toBe(200);
    expect((await alice("GET", `/repos/${ORG}/client-acme-analytics`)).status).toBe(200);
  });

  it("Acme pod cannot read Globex, and cannot even learn it exists (404, not 403)", async () => {
    expect((await alice("GET", `/repos/${ORG}/client-globex-cloud`)).status).toBe(404);
    const raw = await alice("GET", `/repos/${ORG}/client-globex-cloud/raw/business-context.md`);
    expect(raw.status).toBe(404);
    expect(JSON.stringify(raw.json)).not.toContain(CANARY);
  });

  it("Globex does not appear in Acme's repository listings or search", async () => {
    for (const path of [`/orgs/${ORG}/repos`, "/repos/search?q=globex&limit=50", "/user/repos"]) {
      const res = await alice("GET", path);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.json)).not.toMatch(/globex/i);
    }
  });

  it("Acme pod cannot clone Globex over Git", () => {
    const clone = () =>
      execFileSync(
        "git",
        [
          "-c",
          `http.extraHeader=Authorization: ${basicAuth({ username: "alice.synthetic", password })}`,
          "ls-remote",
          `${FORGEJO_URL}/${ORG}/client-globex-cloud.git`,
        ],
        { stdio: "pipe" },
      );
    expect(clone).toThrow();
  });

  it("isolation is symmetric: Globex pod cannot read Acme", async () => {
    expect((await bob("GET", `/repos/${ORG}/client-globex-cloud`)).status).toBe(200);
    expect((await bob("GET", `/repos/${ORG}/client-acme-analytics`)).status).toBe(404);
  });
});

describe.skipIf(!live)("change control (live stack)", () => {
  const repo = `/repos/${ORG}/client-acme-analytics`;

  it("nobody can write directly to main, even with write access", async () => {
    const res = await alice("POST", `${repo}/contents/learnings/direct.md`, {
      content: b64("# should be refused\n"),
      message: "direct write attempt",
      branch: "main",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("a change can be proposed as a branch + pull request, but not merged unapproved", async () => {
    const branch = `proposal-${Date.now()}`;
    const write = await alice("POST", `${repo}/contents/learnings/proposed.md`, {
      content: b64("# Proposed learning\n"),
      message: "Propose a learning",
      branch: "main",
      new_branch: branch,
    });
    expect(write.status).toBe(201);

    const pr = await alice("POST", `${repo}/pulls`, {
      base: "main",
      head: branch,
      title: "Proposed learning (isolation test)",
    });
    expect(pr.status).toBe(201);
    const number = (pr.json as { number: number }).number;

    const merge = await alice("POST", `${repo}/pulls/${number}/merge`, { Do: "merge" });
    expect(merge.status).toBeGreaterThanOrEqual(400);

    // Clean up: close the PR and delete the branch so repeated runs stay tidy.
    await alice("PATCH", `${repo}/pulls/${number}`, { state: "closed" });
    await alice("DELETE", `${repo}/branches/${branch}`);
  });

  it("read-only staff cannot propose changes to company knowledge", async () => {
    const res = await alice("POST", `/repos/${ORG}/company/contents/sops/new.md`, {
      content: b64("# nope\n"),
      message: "attempt",
      branch: "main",
      new_branch: `attempt-${Date.now()}`,
    });
    expect([403, 404]).toContain(res.status);
  });
});
