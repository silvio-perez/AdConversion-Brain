// Skills against real Forgejo: who may publish, and publish -> agent -> install.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORGEJO_URL, loadLocalEnv, ORG } from "./env.ts";
import { forgejo } from "./forgejo.ts";
import { brainCli, createToken, GATEWAY, gatewayEnv, mcpCall } from "./live.ts";

const live = process.env.BRAIN_STACK === "1";
const env = live ? loadLocalEnv() : {};
const pw = env.SYNTHETIC_USER_PASSWORD ?? "";
const carol = forgejo({ username: "carol.synthetic", password: pw }); // knowledge admin
const alice = forgejo({ username: "alice.synthetic", password: pw }); // read-only on skills
const tags = `/repos/${ORG}/skills/tags`;

async function nextVersion(name: string): Promise<number> {
  const res = await carol("GET", `${tags}?limit=50`);
  const versions = (res.json as { name: string }[])
    .map((t) => new RegExp(`^${name}/v(\\d+)$`).exec(t.name)?.[1])
    .filter(Boolean)
    .map(Number);
  return Math.max(0, ...versions) + 1;
}

describe.skipIf(!live)("skills (live stack)", () => {
  it("only knowledge admins can publish a release", async () => {
    const v = await nextVersion("meeting-recap");
    const byAlice = await alice("POST", tags, { tag_name: `meeting-recap/v${v}`, target: "main" });
    expect(byAlice.status).toBeGreaterThanOrEqual(400);
    const byBot = await fetch(`${FORGEJO_URL}/api/v1${tags}`, {
      method: "POST",
      headers: {
        authorization: `token ${gatewayEnv().FORGEJO_PROPOSER_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ tag_name: `meeting-recap/v${v}`, target: "main" }),
    });
    expect(byBot.status).toBeGreaterThanOrEqual(400);
  });

  it("publish a new version -> agents see it -> sync installs it", async () => {
    const v = await nextVersion("linkedin-ad-copy");
    const pub = await carol("POST", tags, {
      tag_name: `linkedin-ad-copy/v${v}`,
      target: "main",
      message: "test",
    });
    expect(pub.status, JSON.stringify(pub.json)).toBe(201);
    expect(brainCli("reindex").ok).toBe(true);

    const token = createToken("alice.synthetic", "codex-cli", "company,skills");
    const listed = (await mcpCall(token, "list_skills", {})).json() as unknown as {
      name: string;
      version: number;
    }[];
    expect(listed.find((s) => s.name === "linkedin-ad-copy")?.version).toBe(v);
    const skill = await mcpCall(token, "get_skill", { name: "meeting-recap" });
    expect(skill.text).toContain("templates/recap.md");

    const target = mkdtempSync(join(tmpdir(), "live-skills-"));
    const out = execFileSync(
      "pnpm",
      ["-s", "skills", "--target", target, "--add", "meeting-recap"],
      {
        encoding: "utf8",
        env: { ...process.env, BRAIN_TOKEN: token, BRAIN_URL: GATEWAY, XDG_CONFIG_HOME: target },
      },
    );
    expect(out).toContain("Installed");
    const marker = JSON.parse(
      readFileSync(join(target, "linkedin-ad-copy", ".brain-skill.json"), "utf8"),
    ) as {
      version: number;
    };
    expect(marker.version).toBe(v);
    expect(readFileSync(join(target, "meeting-recap", "templates", "recap.md"), "utf8")).toContain(
      "Recap",
    );
  });

  it("a token without the skills source can't list skills", async () => {
    const token = createToken("alice.synthetic", "claude-code", "client-acme-analytics");
    const res = await mcpCall(token, "list_skills", {});
    expect(res.isError).toBe(true);
  });
});
