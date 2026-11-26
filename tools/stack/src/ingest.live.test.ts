// Grain ingestion against real Forgejo + gateway, using synthetic meetings and
// the local stand-in model (nothing leaves the machine).
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLocalEnv, ORG } from "./env.ts";
import { forgejo } from "./forgejo.ts";
import { brainCli, GATEWAY } from "./live.ts";

const live = process.env.BRAIN_STACK === "1";
const env = live ? loadLocalEnv() : {};
const pw = env.SYNTHETIC_USER_PASSWORD ?? "";
const alice = forgejo({ username: "alice.synthetic", password: pw });
const bob = forgejo({ username: "bob.synthetic", password: pw });

function ingestToken(vendor: string): string {
  const res = brainCli(
    "token",
    "create",
    "--owner",
    "brain-ingest",
    "--harness",
    "custom",
    "--vendor",
    vendor,
    "--mode",
    "propose",
    "--sources",
    "client-acme-analytics,client-globex-cloud",
    "--days",
    "1",
  );
  expect(res.ok, res.out).toBe(true);
  return res.out.split("\n").find((l) => l.startsWith("brn_")) ?? "";
}

const ingest = (token: string) =>
  execFileSync("pnpm", ["-s", "ingest", "--since", "2026-11-01"], {
    encoding: "utf8",
    env: {
      ...process.env,
      INGEST_TOKEN: token,
      BRAIN_URL: GATEWAY,
      INGEST_STATE: join(mkdtempSync(join(tmpdir(), "ingest-live-")), "state.db"),
    },
  });

describe.skipIf(!live)("Grain ingestion (live stack)", () => {
  it("proposes per-client learnings, skips what it must, and never duplicates", () => {
    const token = ingestToken("local");
    const first = ingest(token);
    expect(first).toContain("synthetic-meeting-1003: skipped_internal");
    expect(first).toContain("synthetic-meeting-1004: skipped_ambiguous");
    expect(first).toMatch(/synthetic-meeting-1001: (proposed|already_done)/);

    // A second run with a brand-new local state still creates nothing new.
    const second = ingest(token);
    expect(second).toContain("0 proposal(s)");
    expect(second).toContain("synthetic-meeting-1001: already_done");
  });

  it("proposals land only in the right client's repository, as reviewable PRs", async () => {
    const acmePulls = await alice(
      "GET",
      `/repos/${ORG}/client-acme-analytics/pulls?state=all&limit=50`,
    );
    const titles = (acmePulls.json as { title: string; user: { login: string } }[])
      .filter((p) => p.title.includes("Meeting learnings"))
      .map((p) => [p.title, p.user.login]);
    expect(titles.some(([t]) => t?.includes("Acme Analytics weekly sync"))).toBe(true);
    expect(titles.every(([, who]) => who === "brain-proposer")).toBe(true);
    expect(JSON.stringify(titles)).not.toMatch(/globex/i);

    // Bob (Globex pod) can't see Acme's proposals at all.
    expect((await bob("GET", `/repos/${ORG}/client-acme-analytics/pulls`)).status).toBe(404);
  });

  it("an ingestion token can't be issued for a vendor a client hasn't approved", () => {
    const res = brainCli(
      "token",
      "create",
      "--owner",
      "brain-ingest",
      "--harness",
      "custom",
      "--vendor",
      "openai",
      "--mode",
      "propose",
      "--sources",
      "client-globex-cloud",
    );
    expect(res.ok).toBe(false);
    expect(res.out).toContain("not an approved vendor");
  });
});
