// Published skills. A skill on `main` is a draft; a release tag
// `<name>/v<N>` publishes an immutable version. Only the latest release of
// each skill is served, filtered by `skills.yaml` (required/optional/deprecated).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { splitFrontmatter } from "@brain/knowledge";
import { parse } from "yaml";
import type { Store } from "./store.ts";

export const SKILLS_SOURCE = "skills";
export const MAX_SKILL_FILE_BYTES = 200_000;
const TAG_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/v([1-9][0-9]*)$/;

export interface SkillRelease {
  name: string;
  version: number;
  tag: string;
  commitSha: string;
}

export interface SkillSource {
  /** Changes whenever a tag or skills.yaml changes; cheap to poll. */
  signature(): Promise<string>;
  /** All release tags (any version). */
  tags(): Promise<SkillRelease[]>;
  /** skills.yaml on main, or null. */
  manifest(): Promise<string | null>;
  /** Files inside the skill's folder at the release, paths relative to the folder. */
  files(release: SkillRelease): Promise<{ path: string; read: () => Promise<Buffer> }[]>;
}

export function parseTag(tag: string): { name: string; version: number } | null {
  const m = TAG_RE.exec(tag);
  return m?.[1] && m[2] ? { name: m[1], version: Number(m[2]) } : null;
}

export function latestReleases(tags: SkillRelease[]): SkillRelease[] {
  const best = new Map<string, SkillRelease>();
  for (const t of tags) {
    const cur = best.get(t.name);
    if (!cur || t.version > cur.version) best.set(t.name, t);
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

type Status = "required" | "optional" | "deprecated";
export function parseManifest(text: string | null): Map<string, Status> {
  const out = new Map<string, Status>();
  if (!text) return out;
  const doc = parse(text) as { skills?: Record<string, { status?: string }> } | null;
  for (const [name, v] of Object.entries(doc?.skills ?? {})) {
    const st = v?.status;
    out.set(name, st === "required" || st === "deprecated" ? st : "optional");
  }
  return out;
}

/** Text files only; binary or oversized files are skipped (and reported). */
function asText(buf: Buffer): string | null {
  if (buf.length > MAX_SKILL_FILE_BYTES || buf.includes(0)) return null;
  const text = buf.toString("utf8");
  return Buffer.from(text, "utf8").equals(buf) ? text : null;
}

/** Bring the published-skills tables in line with the source. Returns names changed. */
export async function syncSkills(db: Store, source: SkillSource): Promise<string[]> {
  const sig = await source.signature();
  const known = db.prepare("SELECT commit_sha FROM sources WHERE name = 'skills#releases'").get() as
    | { commit_sha: string }
    | undefined;
  if (known?.commit_sha === sig) return [];

  const manifest = parseManifest(await source.manifest());
  const releases = latestReleases(await source.tags()).filter(
    (r) => manifest.get(r.name) !== "deprecated",
  );
  const loaded: {
    r: SkillRelease;
    description: string;
    status: Status;
    files: { path: string; text: string }[];
  }[] = [];
  for (const r of releases) {
    const files: { path: string; text: string }[] = [];
    for (const f of await source.files(r)) {
      const text = asText(await f.read());
      if (text === null)
        console.warn(`skill ${r.tag}: skipped non-text or oversized file ${f.path}`);
      else files.push({ path: f.path, text });
    }
    const skillMd = files.find((f) => f.path === "SKILL.md");
    if (!skillMd) {
      console.warn(`skill ${r.tag}: no SKILL.md, not published`);
      continue;
    }
    const fm = (splitFrontmatter(skillMd.text)?.data ?? {}) as { description?: unknown };
    loaded.push({
      r,
      description: typeof fm.description === "string" ? fm.description : "",
      status: manifest.get(r.name) ?? "optional",
      files,
    });
  }

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM skills; DELETE FROM skill_files;");
    const insSkill = db.prepare(
      "INSERT INTO skills (name, version, tag, commit_sha, description, status, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const insFile = db.prepare(
      "INSERT INTO skill_files (name, path, content, sha256) VALUES (?, ?, ?, ?)",
    );
    const now = new Date().toISOString();
    for (const s of loaded) {
      insSkill.run(s.r.name, s.r.version, s.r.tag, s.r.commitSha, s.description, s.status, now);
      for (const f of s.files)
        insFile.run(s.r.name, f.path, f.text, createHash("sha256").update(f.text).digest("hex"));
    }
    db.prepare(
      `INSERT INTO sources (name, client, commit_sha, indexed_at) VALUES ('skills#releases', NULL, ?, ?)
       ON CONFLICT(name) DO UPDATE SET commit_sha = excluded.commit_sha, indexed_at = excluded.indexed_at`,
    ).run(sig, now);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return loaded.map((s) => s.r.tag);
}

/** Tests: every skill folder in the fixtures counts as published v1. */
export class FixtureSkillSource implements SkillSource {
  readonly #root: string;
  constructor(skillsRoot: string) {
    this.#root = skillsRoot;
  }
  async signature() {
    return createHash("sha1")
      .update(JSON.stringify(await this.tags()))
      .update((await this.manifest()) ?? "")
      .digest("hex");
  }
  async tags() {
    return readdirSync(this.#root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(this.#root, e.name, "SKILL.md")))
      .map((e) => ({ name: e.name, version: 1, tag: `${e.name}/v1`, commitSha: "fixture" }));
  }
  async manifest() {
    const f = join(this.#root, "skills.yaml");
    return existsSync(f) ? readFileSync(f, "utf8") : null;
  }
  async files(r: SkillRelease) {
    const base = join(this.#root, r.name);
    const out: { path: string; read: () => Promise<Buffer> }[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else
          out.push({
            path: relative(base, full).split(sep).join("/"),
            read: async () => readFileSync(full),
          });
      }
    };
    walk(base);
    return out;
  }
}

/** Production: tags and files from the Forgejo `skills` repository (read-only token). */
export class ForgejoSkillSource implements SkillSource {
  readonly #base: string;
  readonly #token: string;
  constructor(opts: { url: string; org: string; token: string }) {
    this.#base = `${opts.url.replace(/\/$/, "")}/api/v1/repos/${opts.org}/${SKILLS_SOURCE}`;
    this.#token = opts.token;
  }
  async #get(path: string): Promise<Response> {
    return fetch(`${this.#base}${path}`, { headers: { authorization: `token ${this.#token}` } });
  }
  async #json<T>(path: string): Promise<T> {
    const res = await this.#get(path);
    if (!res.ok) throw new Error(`Forgejo skills ${path} -> ${res.status}`);
    return (await res.json()) as T;
  }
  async signature() {
    const branch = await this.#json<{ commit: { id: string } }>("/branches/main");
    return createHash("sha1")
      .update(JSON.stringify(await this.tags()))
      .update(branch.commit.id)
      .digest("hex");
  }
  async tags() {
    const out: SkillRelease[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.#json<{ name: string; commit: { sha: string } }[]>(
        `/tags?limit=50&page=${page}`,
      );
      for (const t of batch) {
        const p = parseTag(t.name);
        if (p) out.push({ ...p, tag: t.name, commitSha: t.commit.sha });
      }
      if (batch.length < 50) return out;
    }
  }
  async manifest() {
    const res = await this.#get("/raw/skills.yaml?ref=main");
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Forgejo skills.yaml -> ${res.status}`);
    return res.text();
  }
  async files(r: SkillRelease) {
    const tree = await this.#json<{ tree: { path: string; type: string }[]; truncated: boolean }>(
      `/git/trees/${r.commitSha}?recursive=true&per_page=10000`,
    );
    if (tree.truncated) throw new Error("skills tree truncated");
    const prefix = `${r.name}/`;
    return tree.tree
      .filter((e) => e.type === "blob" && e.path.startsWith(prefix))
      .map((e) => ({
        path: e.path.slice(prefix.length),
        read: async () => {
          const res = await this.#get(`/raw/${encodeURI(e.path)}?ref=${encodeURIComponent(r.tag)}`);
          if (!res.ok) throw new Error(`Forgejo skill file ${e.path} -> ${res.status}`);
          return Buffer.from(await res.arrayBuffer());
        },
      }));
  }
}
