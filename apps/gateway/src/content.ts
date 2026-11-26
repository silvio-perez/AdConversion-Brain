// Where knowledge comes from. Production reads Forgejo; tests read the
// synthetic fixture folders directly, so the whole gateway is testable
// without a running Git server.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface SourceSnapshot {
  name: string;
  commitSha: string;
  files: { path: string; revision: string; read: () => Promise<string> }[];
}

export interface ContentSource {
  /** Current commit of each repository, cheap enough to poll. */
  heads(): Promise<{ name: string; commitSha: string }[]>;
  snapshot(name: string, commitSha: string): Promise<SourceSnapshot>;
}

/** Reads `fixtures/synthetic/<repo>/**.md`. Revisions are content hashes. */
export class FixtureSource implements ContentSource {
  readonly #root: string;
  constructor(root: string) {
    this.#root = root;
  }

  #files(name: string): { path: string; text: string }[] {
    const base = join(this.#root, name);
    const out: { path: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".md"))
          out.push({
            path: relative(base, full).split(sep).join("/"),
            text: readFileSync(full, "utf8"),
          });
      }
    };
    walk(base);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async heads() {
    return readdirSync(this.#root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const h = createHash("sha1");
        for (const f of this.#files(e.name)) h.update(f.path).update(f.text);
        return { name: e.name, commitSha: h.digest("hex") };
      });
  }

  async snapshot(name: string, commitSha: string): Promise<SourceSnapshot> {
    return {
      name,
      commitSha,
      files: this.#files(name).map((f) => ({
        path: f.path,
        revision: createHash("sha1").update(f.text).digest("hex"),
        read: async () => f.text,
      })),
    };
  }
}

/** Reads repositories of one Forgejo organisation through a read-only token. */
export class ForgejoSource implements ContentSource {
  readonly #url: string;
  readonly #org: string;
  readonly #token: string;
  constructor(opts: { url: string; org: string; token: string }) {
    this.#url = opts.url.replace(/\/$/, "");
    this.#org = opts.org;
    this.#token = opts.token;
  }

  async #get(path: string): Promise<Response> {
    const res = await fetch(`${this.#url}/api/v1${path}`, {
      headers: { authorization: `token ${this.#token}`, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Forgejo GET ${path} -> ${res.status}`);
    return res;
  }

  async heads() {
    const repos = (await (await this.#get(`/orgs/${this.#org}/repos?limit=50`)).json()) as {
      name: string;
      empty: boolean;
      default_branch: string;
    }[];
    const out: { name: string; commitSha: string }[] = [];
    for (const r of repos.filter((r) => !r.empty)) {
      const branch = (await (
        await this.#get(`/repos/${this.#org}/${r.name}/branches/${r.default_branch}`)
      ).json()) as { commit: { id: string } };
      out.push({ name: r.name, commitSha: branch.commit.id });
    }
    return out;
  }

  async snapshot(name: string, commitSha: string): Promise<SourceSnapshot> {
    const tree = (await (
      await this.#get(
        `/repos/${this.#org}/${name}/git/trees/${commitSha}?recursive=true&per_page=10000`,
      )
    ).json()) as { tree: { path: string; type: string; sha: string }[]; truncated: boolean };
    if (tree.truncated) throw new Error(`tree for ${name} truncated; paging not implemented yet`);
    return {
      name,
      commitSha,
      files: tree.tree
        .filter((e) => e.type === "blob" && e.path.endsWith(".md"))
        .map((e) => ({
          path: e.path,
          revision: e.sha,
          read: async () =>
            (
              await this.#get(
                `/repos/${this.#org}/${name}/raw/${encodeURI(e.path)}?ref=${commitSha}`,
              )
            ).text(),
        })),
    };
  }
}
