import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { makeGateway } from "../../../apps/gateway/src/testkit.ts";
import { MARKER, safeRelativePath, syncSkills } from "./sync.ts";

type GW = Awaited<ReturnType<typeof makeGateway>>;
let gw: GW;
let token: string;
beforeAll(async () => {
  gw = await makeGateway();
  token = gw.token();
});

const fetchJson = (tok: string) => async (path: string) => {
  const res = await gw.get(path, tok);
  if (res.status !== 200) throw new Error(`${path}: ${res.status}`);
  return res.json;
};
const dirs = () => {
  const root = mkdtempSync(join(tmpdir(), "skills-sync-"));
  return [join(root, "claude"), join(root, "agents")];
};

describe("skills sync", () => {
  it("installs required skills into every target, and optional ones only on request", async () => {
    const targets = dirs();
    const r = await syncSkills({ fetchJson: fetchJson(token), targets, optional: [] });
    expect(r.installed).toHaveLength(2); // linkedin-ad-copy into 2 targets
    for (const t of targets) {
      expect(readFileSync(join(t, "linkedin-ad-copy", "SKILL.md"), "utf8")).toContain(
        "name: linkedin-ad-copy",
      );
      expect(existsSync(join(t, "meeting-recap"))).toBe(false);
    }
    const r2 = await syncSkills({
      fetchJson: fetchJson(token),
      targets,
      optional: ["meeting-recap"],
    });
    expect(r2.unchanged).toHaveLength(2);
    expect(r2.installed).toHaveLength(2);
    expect(
      readFileSync(join(targets[0] ?? "", "meeting-recap", "templates", "recap.md"), "utf8"),
    ).toContain("Recap");
  });

  it("is idempotent, and removes Brain-installed skills you opt out of", async () => {
    const targets = dirs();
    await syncSkills({ fetchJson: fetchJson(token), targets, optional: ["meeting-recap"] });
    const again = await syncSkills({
      fetchJson: fetchJson(token),
      targets,
      optional: ["meeting-recap"],
    });
    expect(again.installed).toEqual([]);
    expect(again.unchanged).toHaveLength(4);
    const out = await syncSkills({ fetchJson: fetchJson(token), targets, optional: [] });
    expect(out.removed).toHaveLength(2);
    expect(existsSync(join(targets[0] ?? "", "meeting-recap"))).toBe(false);
  });

  it("never overwrites or deletes a skill folder it didn't create", async () => {
    const [target = ""] = dirs();
    mkdirSync(join(target, "linkedin-ad-copy"), { recursive: true });
    writeFileSync(join(target, "linkedin-ad-copy", "SKILL.md"), "my own hand-written skill");
    mkdirSync(join(target, "personal-skill"));
    writeFileSync(join(target, "personal-skill", "SKILL.md"), "mine");

    const r = await syncSkills({ fetchJson: fetchJson(token), targets: [target], optional: [] });
    expect(r.skipped[0]).toContain("was not installed by the Brain");
    expect(readFileSync(join(target, "linkedin-ad-copy", "SKILL.md"), "utf8")).toBe(
      "my own hand-written skill",
    );
    expect(existsSync(join(target, "personal-skill", "SKILL.md"))).toBe(true);
  });

  it("upgrades when a new version is published", async () => {
    const [target = ""] = dirs();
    await syncSkills({ fetchJson: fetchJson(token), targets: [target], optional: [] });
    gw.db.exec(
      "UPDATE skills SET version = 2, tag = 'linkedin-ad-copy/v2' WHERE name = 'linkedin-ad-copy'",
    );
    const r = await syncSkills({ fetchJson: fetchJson(token), targets: [target], optional: [] });
    expect(r.updated).toEqual([`${join(target, "linkedin-ad-copy")} (v2)`]);
    const marker = JSON.parse(readFileSync(join(target, "linkedin-ad-copy", MARKER), "utf8")) as {
      version: number;
    };
    expect(marker.version).toBe(2);
    gw.db.exec(
      "UPDATE skills SET version = 1, tag = 'linkedin-ad-copy/v1' WHERE name = 'linkedin-ad-copy'",
    );
  });

  it("refuses files that could escape the skills folder or were corrupted", async () => {
    for (const bad of ["../../.bashrc", "/etc/passwd", "a/../../b", ".hidden/x", "a\\b", ""])
      expect(safeRelativePath(bad), bad).toBe(false);
    expect(safeRelativePath("templates/recap.md")).toBe(true);

    const [target = ""] = dirs();
    const evil = async (path: string) => {
      const real = (await fetchJson(token)(path)) as Record<string, unknown>;
      if (!path.endsWith("/bundle")) return real;
      return { ...real, contents: [{ path: "../../escape.md", content: "x", sha256: "x" }] };
    };
    const r = await syncSkills({ fetchJson: evil, targets: [target], optional: [] });
    expect(r.skipped[0]).toContain("refused unsafe or corrupted file");
    expect(existsSync(join(target, "..", "..", "escape.md"))).toBe(false);
    expect(existsSync(join(target, "linkedin-ad-copy"))).toBe(false);
  });
});
