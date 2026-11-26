// How agent proposals reach Git: a new branch + pull request, opened by the
// brain-proposer bot. Branch protection means only an approved human merge
// ever changes `main` (SEC-INT-1). Tests use the in-memory writer below.
import { randomBytes } from "node:crypto";

export interface OpenProposalInput {
  source: string;
  path: string;
  content: string;
  /** Blob revision the agent read. null = new document. */
  baseRevision: string | null;
  branch: string;
  commitMessage: string;
  title: string;
  body: string;
}

export interface ProposalStatus {
  state: "open" | "merged" | "closed";
  mergedBy: string | null;
  approvedBy: string[];
}

export interface ProposalWriter {
  /** Current revision of a document on main, read live (not from the index). */
  currentRevision(source: string, path: string): Promise<string | null>;
  open(input: OpenProposalInput): Promise<{ number: number; url: string }>;
  status(source: string, number: number): Promise<ProposalStatus>;
}

export class StaleRevisionError extends Error {}
export class InvalidProposalError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Proposal rejected: ${problems.join("; ")}`);
    this.problems = problems;
  }
}

export const MAX_CONTENT_BYTES = 100_000;
const PATH_RE = /^(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.md$/;

/** Lower-case relative markdown paths only: no traversal, hidden files or other formats. */
export function checkPath(path: string): string | null {
  if (
    !PATH_RE.test(path) ||
    path.split("/").some((p) => p === "." || p === ".." || p.startsWith("."))
  )
    return "path must be a lower-case relative .md path like 'learnings/2026-11-result.md'";
  return null;
}

export function branchName(owner: string, path: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  const slug = path
    .replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/-+$/, "");
  const who = owner.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `proposal/${who}/${day}-${slug}-${randomBytes(2).toString("hex")}`;
}

export interface Evidence {
  kind: string;
  ref: string;
  at?: string | undefined;
}

/** The pull request a reviewer reads. Plain language first; machine marker last. */
export function proposalBody(p: {
  summary: string;
  path: string;
  kind: "update" | "new";
  owner: string;
  harness: string;
  vendor: string;
  tokenName: string;
  tokenId: string;
  proposalId: string;
  evidence: Evidence[];
}): string {
  const evidence = p.evidence.length
    ? p.evidence.map((e) => `- **${e.kind}:** \`${e.ref}\`${e.at ? ` at ${e.at}` : ""}`).join("\n")
    : "- _None given. Ask the proposer where this came from before approving._";
  return `## What changes and why

${p.summary}

| | |
|---|---|
| Document | \`${p.path}\` (${p.kind === "new" ? "new document" : "update"}) |
| Proposed by | an AI agent (${p.harness}, ${p.vendor}) acting for @${p.owner} |
| Token | ${p.tokenName} (\`${p.tokenId.slice(0, 8)}\`) |

## Evidence

${evidence}

## Reviewer checklist

- [ ] The change is supported by the evidence above
- [ ] Nothing from another client appears in this document
- [ ] Nothing in the text reads like instructions to an AI (for example "ignore previous instructions")
- [ ] \`status\`, \`owner\` and \`last_reviewed\` in the frontmatter are right

Approve to make this the source of truth. Request changes, or close, to reject it.

<!-- brain-proposal id=${p.proposalId} token=${p.tokenId} -->
`;
}

/** Forgejo implementation, using the brain-proposer bot's token. */
export class ForgejoWriter implements ProposalWriter {
  readonly #url: string;
  readonly #org: string;
  readonly #token: string;
  constructor(opts: { url: string; org: string; token: string }) {
    this.#url = opts.url.replace(/\/$/, "");
    this.#org = opts.org;
    this.#token = opts.token;
  }

  async #call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const res = await fetch(`${this.#url}/api/v1/repos/${this.#org}${path}`, {
      method,
      headers: {
        authorization: `token ${this.#token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as unknown) : null };
  }

  async currentRevision(source: string, path: string): Promise<string | null> {
    const res = await this.#call("GET", `/${source}/contents/${encodeURI(path)}?ref=main`);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`Forgejo contents ${source}/${path} -> ${res.status}`);
    return (res.json as { sha: string }).sha;
  }

  async open(input: OpenProposalInput): Promise<{ number: number; url: string }> {
    const write = await this.#call(
      input.baseRevision ? "PUT" : "POST",
      `/${input.source}/contents/${encodeURI(input.path)}`,
      {
        content: Buffer.from(input.content, "utf8").toString("base64"),
        message: input.commitMessage,
        branch: "main",
        new_branch: input.branch,
        ...(input.baseRevision ? { sha: input.baseRevision } : {}),
      },
    );
    // Forgejo re-checks the revision itself: a race since our check is refused too.
    if (write.status === 409 || write.status === 422)
      throw new StaleRevisionError("The document changed while the proposal was being created.");
    if (write.status >= 400)
      throw new Error(`Forgejo write ${input.source}/${input.path} -> ${write.status}`);
    const pr = await this.#call("POST", `/${input.source}/pulls`, {
      base: "main",
      head: input.branch,
      title: input.title,
      body: input.body,
    });
    if (pr.status >= 400) throw new Error(`Forgejo pull request -> ${pr.status}`);
    const { number, html_url } = pr.json as { number: number; html_url: string };
    return { number, url: html_url };
  }

  async status(source: string, number: number): Promise<ProposalStatus> {
    const pr = await this.#call("GET", `/${source}/pulls/${number}`);
    if (pr.status !== 200) throw new Error(`Forgejo pull ${source}#${number} -> ${pr.status}`);
    const p = pr.json as { state: string; merged: boolean; merged_by: { login: string } | null };
    const reviews = await this.#call("GET", `/${source}/pulls/${number}/reviews`);
    const approvedBy = ((reviews.json as { state: string; user: { login: string } }[] | null) ?? [])
      .filter((r) => r.state === "APPROVED")
      .map((r) => r.user.login);
    return {
      state: p.merged ? "merged" : p.state === "closed" ? "closed" : "open",
      mergedBy: p.merged_by?.login ?? null,
      approvedBy: [...new Set(approvedBy)],
    };
  }
}

/** In-memory writer for tests: same contract, including the revision check. */
export class MemoryWriter implements ProposalWriter {
  readonly files = new Map<string, { revision: string; content: string }>();
  readonly opened: (OpenProposalInput & { number: number })[] = [];
  readonly statuses = new Map<string, ProposalStatus>();

  async currentRevision(source: string, path: string) {
    return this.files.get(`${source}/${path}`)?.revision ?? null;
  }
  async open(input: OpenProposalInput) {
    const current = await this.currentRevision(input.source, input.path);
    if (current !== input.baseRevision) throw new StaleRevisionError("changed concurrently");
    const number = this.opened.length + 1;
    this.opened.push({ ...input, number });
    this.statuses.set(`${input.source}#${number}`, {
      state: "open",
      mergedBy: null,
      approvedBy: [],
    });
    return { number, url: `http://forgejo.test/${input.source}/pulls/${number}` };
  }
  async status(source: string, number: number) {
    const s = this.statuses.get(`${source}#${number}`);
    if (!s) throw new Error("unknown proposal");
    return s;
  }
}
