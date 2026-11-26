import { beforeAll, describe, expect, it } from "vitest";
import { latestReleases, parseManifest, parseTag } from "./skills.ts";
import { ACME, makeGateway, toolText } from "./testkit.ts";

type GW = Awaited<ReturnType<typeof makeGateway>>;
let gw: GW;
let staff: string;
beforeAll(async () => {
  gw = await makeGateway();
  staff = gw.token(); // company, skills, Acme
});

describe("release tags and manifest", () => {
  it("parses only well-formed release tags", () => {
    expect(parseTag("linkedin-ad-copy/v12")).toEqual({ name: "linkedin-ad-copy", version: 12 });
    for (const bad of ["linkedin-ad-copy/v0", "v1", "Ad-Copy/v1", "x/v1.2", "../x/v1", "x/v01"])
      expect(parseTag(bad), bad).toBeNull();
  });

  it("serves the highest version of each skill", () => {
    const r = (name: string, version: number) => ({
      name,
      version,
      tag: `${name}/v${version}`,
      commitSha: "c",
    });
    expect(latestReleases([r("a", 1), r("a", 3), r("b", 1), r("a", 2)]).map((x) => x.tag)).toEqual([
      "a/v3",
      "b/v1",
    ]);
  });

  it("defaults unknown statuses to optional", () => {
    const m = parseManifest(
      "skills:\n  a: {status: required}\n  b: {status: nonsense}\n  c: {status: deprecated}\n",
    );
    expect(Object.fromEntries(m)).toEqual({ a: "required", b: "optional", c: "deprecated" });
  });
});

describe("skills over MCP and REST", () => {
  it("lists published skills with required ones first", async () => {
    const res = await gw.get("/v1/skills", staff);
    const skills = (
      res.json as { skills: { name: string; status: string; version: number; files: number }[] }
    ).skills;
    expect(skills.map((s) => [s.name, s.status, s.version])).toEqual([
      ["linkedin-ad-copy", "required", 1],
      ["meeting-recap", "optional", 1],
    ]);
    expect(skills[1]?.files).toBe(2);
  });

  it("an agent can load and follow a skill end to end over MCP", async () => {
    const client = await gw.mcp(staff);
    const listed = toolText(await client.callTool({ name: "list_skills", arguments: {} }));
    expect(listed).toContain("meeting-recap");
    const skill = toolText(
      await client.callTool({ name: "get_skill", arguments: { name: "meeting-recap" } }),
    );
    expect(skill).toContain("templates/recap.md");
    expect(skill).toContain("Do not\\n   change the Brain yourself");
    const tpl = toolText(
      await client.callTool({
        name: "read_skill_file",
        arguments: { name: "meeting-recap", path: "templates/recap.md" },
      }),
    );
    expect(tpl).toContain("Possible Brain updates");
    await client.close();
  });

  it("a token without the skills source sees no skills (same 404 as anything else)", async () => {
    const clientOnly = gw.token({ sources: [ACME] });
    expect((await gw.get("/v1/skills", clientOnly)).status).toBe(404);
    expect((await gw.get("/v1/skills/meeting-recap/bundle", clientOnly)).status).toBe(404);
    const client = await gw.mcp(clientOnly);
    expect((await client.callTool({ name: "list_skills", arguments: {} })).isError).toBe(true);
    await client.close();
  });

  it("unknown skills and files are 404, and paths can't escape the skill", async () => {
    for (const path of [
      "/v1/skills/nope",
      "/v1/skills/meeting-recap/files/nope.md",
      "/v1/skills/meeting-recap/files/..%2Flinkedin-ad-copy%2FSKILL.md",
      "/v1/skills/meeting-recap/files/%2E%2E/%2E%2E/company/README.md",
    ])
      expect((await gw.get(path, staff)).status, path).toBe(404);
  });

  it("drafts are never served: only released versions are in the catalog", () => {
    const rows = gw.db.prepare("SELECT tag FROM skills ORDER BY name").all();
    expect(rows).toEqual([{ tag: "linkedin-ad-copy/v1" }, { tag: "meeting-recap/v1" }]);
  });

  it("skill access is audited with the exact version", async () => {
    await gw.get("/v1/skills/linkedin-ad-copy", staff);
    const row = gw.db
      .prepare(
        "SELECT resource, result FROM audit WHERE action = 'rest:get_skill' ORDER BY id DESC LIMIT 1",
      )
      .get();
    expect(row).toEqual({ resource: "linkedin-ad-copy/v1", result: "ok" });
  });
});
