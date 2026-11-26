// The one place that decides what a caller may see (SEC-ISO-3) and records it
// (SEC-AUD-1). MCP and REST are thin adapters over this class, so isolation is
// implemented exactly once.
import { randomUUID } from "node:crypto";
import { splitFrontmatter, validateDocument } from "@brain/knowledge";
import { type VendorPolicy, vendorAllowed } from "./policy.ts";
import {
  branchName,
  checkPath,
  type Evidence,
  InvalidProposalError,
  MAX_CONTENT_BYTES,
  type ProposalWriter,
  proposalBody,
  StaleRevisionError,
} from "./proposals.ts";
import { SKILLS_SOURCE } from "./skills.ts";
import type { Store } from "./store.ts";
import type { TokenRecord } from "./tokens.ts";

export class NotFoundError extends Error {
  constructor() {
    // Identical for "does not exist" and "exists but not yours" (SEC-ISO-4).
    super("Not found");
  }
}

/** The token is valid but may not do this (e.g. a read-only token proposing). */
export class ForbiddenError extends Error {}
export class RateLimitError extends Error {}

export const MAX_PROPOSALS_PER_HOUR = 20;

export interface ProposeInput {
  source: string;
  path: string;
  content: string;
  /** Revision from read_document for an update; null for a new document. */
  baseRevision: string | null;
  summary: string;
  evidence: Evidence[];
}

export interface ProposalInfo {
  proposalId: string;
  source: string;
  path: string;
  kind: "update" | "new";
  title: string;
  state: "open" | "merged" | "closed";
  url: string;
  owner: string;
  harness: string;
  createdAt: string;
  approvedBy: string | null;
  decidedBy: string | null;
}

export interface SkillInfo {
  name: string;
  version: number;
  tag: string;
  status: "required" | "optional";
  description: string;
  files: number;
}

export interface Caller {
  token: TokenRecord;
  requestId: string;
  /** "mcp" or "rest": recorded in the audit log. */
  via: string;
}

export interface SourceInfo {
  source: string;
  client: string | null;
  documents: number;
  indexedAt: string;
}
export interface DocumentSummary {
  source: string;
  path: string;
  title: string | null;
  type: string | null;
  status: string | null;
  lastReviewed: string | null;
  revision: string;
}
export interface DocumentFull extends DocumentSummary {
  frontmatter: Record<string, unknown>;
  body: string;
}
export interface SearchHit {
  source: string;
  path: string;
  title: string | null;
  snippet: string;
}

const MAX_RESULTS = 25;

/** Turn free text into a safe FTS5 query: each word becomes a quoted term. */
export function toFtsQuery(input: string): string | null {
  const terms = input.match(/[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu)?.slice(0, 12) ?? [];
  return terms.length ? terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" ") : null;
}

export class Brain {
  readonly #db: Store;
  readonly #policy: VendorPolicy;
  readonly #writer: ProposalWriter | null;
  constructor(db: Store, policy: VendorPolicy, writer: ProposalWriter | null = null) {
    this.#db = db;
    this.#policy = policy;
    this.#writer = writer;
  }

  static newCaller(token: TokenRecord, via: string): Caller {
    return { token, requestId: randomUUID(), via };
  }

  /** Sources this caller may see right now: token scope AND vendor policy. */
  scope(caller: Caller): string[] {
    return caller.token.sources.filter((s) => vendorAllowed(this.#policy, s, caller.token.vendor));
  }

  audit(caller: Caller | null, action: string, result: string, source?: string, resource?: string) {
    const t = caller?.token;
    this.#db
      .prepare(
        `INSERT INTO audit (ts, request_id, token_id, owner, harness, vendor, action, source, resource, result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        caller?.requestId ?? randomUUID(),
        t?.id ?? null,
        t?.owner ?? null,
        t?.harness ?? null,
        t?.vendor ?? null,
        caller ? `${caller.via}:${action}` : action,
        source ?? null,
        resource ?? null,
        result,
      );
  }

  #requireSource(caller: Caller, source: string, action: string, resource?: string) {
    if (!this.scope(caller).includes(source)) {
      this.audit(caller, action, "denied", source, resource);
      throw new NotFoundError();
    }
  }

  whoami(caller: Caller) {
    this.audit(caller, "whoami", "ok");
    const t = caller.token;
    return {
      name: t.name,
      owner: t.owner,
      harness: t.harness,
      vendor: t.vendor,
      mode: t.mode,
      sources: this.scope(caller),
      expiresAt: t.expiresAt,
    };
  }

  listSources(caller: Caller): SourceInfo[] {
    const scope = this.scope(caller);
    this.audit(caller, "list_sources", "ok");
    if (!scope.length) return [];
    const marks = scope.map(() => "?").join(",");
    return (
      this.#db
        .prepare(
          `SELECT s.name AS source, s.client, s.indexed_at AS indexedAt,
                  (SELECT COUNT(*) FROM documents d WHERE d.source = s.name) AS documents
           FROM sources s WHERE s.name IN (${marks}) ORDER BY s.name`,
        )
        .all(...scope) as unknown as SourceInfo[]
    ).map((r) => ({ ...r, documents: Number(r.documents) }));
  }

  listDocuments(caller: Caller, source: string, prefix = ""): DocumentSummary[] {
    this.#requireSource(caller, source, "list_documents", prefix || undefined);
    this.audit(caller, "list_documents", "ok", source, prefix || undefined);
    return this.#db
      .prepare(
        `SELECT source, path, title, type, status, last_reviewed AS lastReviewed, revision
         FROM documents WHERE source = ? AND substr(path, 1, ?) = ? ORDER BY path`,
      )
      .all(source, prefix.length, prefix) as unknown as DocumentSummary[];
  }

  readDocument(caller: Caller, source: string, path: string): DocumentFull {
    this.#requireSource(caller, source, "read_document", path);
    const row = this.#db
      .prepare(
        `SELECT source, path, title, type, status, last_reviewed AS lastReviewed, revision, frontmatter, body
         FROM documents WHERE source = ? AND path = ?`,
      )
      .get(source, path) as
      | (Omit<DocumentFull, "frontmatter"> & { frontmatter: string })
      | undefined;
    if (!row) {
      this.audit(caller, "read_document", "not_found", source, path);
      throw new NotFoundError();
    }
    this.audit(caller, "read_document", "ok", source, path);
    return { ...row, frontmatter: JSON.parse(row.frontmatter) as Record<string, unknown> };
  }

  search(
    caller: Caller,
    query: string,
    opts: { source?: string; limit?: number } = {},
  ): SearchHit[] {
    // Scope is applied inside the same SQL query as the match, so out-of-scope
    // documents are never ranked, snippeted or returned (SEC-ISO-3).
    let scope = this.scope(caller);
    if (opts.source) {
      this.#requireSource(caller, opts.source, "search", query);
      scope = [opts.source];
    }
    const fts = toFtsQuery(query);
    if (!fts || !scope.length) {
      this.audit(caller, "search", "ok", opts.source, query);
      return [];
    }
    const limit = Math.min(Math.max(1, opts.limit ?? 10), MAX_RESULTS);
    const marks = scope.map(() => "?").join(",");
    const hits = this.#db
      .prepare(
        `SELECT source, path, title, snippet(documents_fts, 3, '**', '**', ' … ', 24) AS snippet
         FROM documents_fts WHERE documents_fts MATCH ? AND source IN (${marks})
         ORDER BY bm25(documents_fts, 0, 0, 5.0, 1.0) LIMIT ?`,
      )
      .all(fts, ...scope, limit) as unknown as SearchHit[];
    this.audit(caller, "search", "ok", opts.source, query);
    return hits;
  }

  /**
   * Open a proposal for human review. Agents can never change canonical
   * knowledge directly (SEC-INT-1); this creates a branch + pull request.
   */
  async propose(caller: Caller, input: ProposeInput) {
    const action = input.baseRevision ? "propose_change" : "propose_document";
    if (caller.token.mode !== "propose") {
      this.audit(caller, action, "denied_read_only", input.source, input.path);
      throw new ForbiddenError(
        "This token is read-only. Ask an admin for a token with --mode propose.",
      );
    }
    this.#requireSource(caller, input.source, action, input.path);
    if (!this.#writer) throw new Error("Proposals are not configured on this gateway.");

    const problems: string[] = [];
    const pathProblem = checkPath(input.path);
    if (pathProblem) problems.push(pathProblem);
    if (Buffer.byteLength(input.content, "utf8") > MAX_CONTENT_BYTES)
      problems.push(`content is larger than ${MAX_CONTENT_BYTES / 1000} KB`);
    if (input.summary.trim().length < 10)
      problems.push("summary must explain the change in at least 10 characters");
    if (!pathProblem)
      problems.push(
        ...validateDocument(input.content, {
          repo: input.source,
          path: input.path,
          requireSynthetic: false,
        }),
      );
    if (problems.length) {
      this.audit(caller, action, "invalid", input.source, input.path);
      throw new InvalidProposalError(problems);
    }

    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const recent = this.#db
      .prepare("SELECT COUNT(*) AS n FROM proposals WHERE token_id = ? AND created_at > ?")
      .get(caller.token.id, hourAgo) as { n: number };
    if (Number(recent.n) >= MAX_PROPOSALS_PER_HOUR) {
      this.audit(caller, action, "rate_limited", input.source, input.path);
      throw new RateLimitError(
        `Limit of ${MAX_PROPOSALS_PER_HOUR} proposals per hour reached for this token.`,
      );
    }

    // Check against Git itself, not the index, which can lag behind (SEC-INT-5).
    const current = await this.#writer.currentRevision(input.source, input.path);
    if (input.baseRevision === null && current !== null) {
      this.audit(caller, action, "exists", input.source, input.path);
      throw new InvalidProposalError([
        "document already exists: read it, then use propose_change with its revision",
      ]);
    }
    if (input.baseRevision !== null && current === null) {
      this.audit(caller, action, "not_found", input.source, input.path);
      throw new NotFoundError();
    }
    if (input.baseRevision !== null && current !== input.baseRevision) {
      this.audit(caller, action, "stale", input.source, input.path);
      throw new StaleRevisionError(
        "The document changed since you read it. Read it again, re-apply your change, and propose with the new revision.",
      );
    }

    const t = caller.token;
    const kind = input.baseRevision ? "update" : "new";
    const proposalId = randomUUID();
    const branch = branchName(t.owner, input.path);
    const docTitle = this.#db
      .prepare("SELECT title FROM documents WHERE source = ? AND path = ?")
      .get(input.source, input.path) as { title: string } | undefined;
    const firstLine = input.summary.trim().split("\n")[0] ?? "";
    // Reviewers scan the PR list: lead with the document's title (from the
    // index for updates, from the proposed frontmatter for new documents).
    const proposedFm = splitFrontmatter(input.content)?.data as
      | { title?: unknown; name?: unknown }
      | undefined;
    const proposedTitle =
      typeof proposedFm?.title === "string"
        ? proposedFm.title
        : typeof proposedFm?.name === "string"
          ? proposedFm.name
          : null;
    const title = `${docTitle?.title ?? proposedTitle ?? input.path}: ${firstLine.length > 70 ? `${firstLine.slice(0, 67)}...` : firstLine}`;
    const body = proposalBody({
      summary: input.summary.trim(),
      path: input.path,
      kind,
      owner: t.owner,
      harness: t.harness,
      vendor: t.vendor,
      tokenName: t.name,
      tokenId: t.id,
      proposalId,
      evidence: input.evidence,
    });

    let pr: { number: number; url: string };
    try {
      pr = await this.#writer.open({
        source: input.source,
        path: input.path,
        content: input.content,
        baseRevision: input.baseRevision,
        branch,
        commitMessage: `${kind === "new" ? "Propose" : "Propose update to"} ${input.path}\n\nProposed by ${t.harness} (${t.vendor}) for ${t.owner}.`,
        title,
        body,
      });
    } catch (err) {
      this.audit(
        caller,
        action,
        err instanceof StaleRevisionError ? "stale" : "error",
        input.source,
        input.path,
      );
      throw err;
    }

    this.#db
      .prepare(
        `INSERT INTO proposals (id, token_id, owner, harness, vendor, source, path, kind, title, branch, pr_number, pr_url, base_revision, created_at, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      )
      .run(
        proposalId,
        t.id,
        t.owner,
        t.harness,
        t.vendor,
        input.source,
        input.path,
        kind,
        title,
        branch,
        pr.number,
        pr.url,
        input.baseRevision,
        new Date().toISOString(),
      );
    this.audit(caller, action, `ok:#${pr.number}`, input.source, input.path);
    return {
      proposalId,
      state: "open" as const,
      reviewUrl: pr.url,
      message:
        "Proposal opened. A human reviewer must approve it before it becomes part of the Brain.",
    };
  }

  listProposals(caller: Caller, source?: string): ProposalInfo[] {
    let scope = this.scope(caller);
    if (source) {
      this.#requireSource(caller, source, "list_proposals");
      scope = [source];
    }
    this.audit(caller, "list_proposals", "ok", source);
    if (!scope.length) return [];
    const marks = scope.map(() => "?").join(",");
    return this.#db
      .prepare(
        `SELECT id AS proposalId, source, path, kind, title, state, pr_url AS url, owner, harness,
                created_at AS createdAt, approved_by AS approvedBy, decided_by AS decidedBy
         FROM proposals WHERE source IN (${marks}) ORDER BY created_at DESC LIMIT 50`,
      )
      .all(...scope) as unknown as ProposalInfo[];
  }

  /**
   * Record human decisions made in Forgejo (approvals, merges, rejections) in
   * our audit log. Called by the same poller that refreshes the index.
   */
  async reconcile(): Promise<number> {
    if (!this.#writer) return 0;
    const open = this.#db
      .prepare(
        "SELECT id, source, path, pr_number, approved_by FROM proposals WHERE state = 'open'",
      )
      .all() as {
      id: string;
      source: string;
      path: string;
      pr_number: number;
      approved_by: string | null;
    }[];
    let changes = 0;
    for (const p of open) {
      const s = await this.#writer.status(p.source, Number(p.pr_number));
      const resource = `${p.path}#${p.pr_number}`;
      const approved = s.approvedBy.join(",") || null;
      if (approved && approved !== p.approved_by) {
        this.#db.prepare("UPDATE proposals SET approved_by = ? WHERE id = ?").run(approved, p.id);
        this.#systemAudit("proposal_approved", approved, p.source, resource);
        changes++;
      }
      if (s.state !== "open") {
        const by = s.mergedBy ?? "unknown";
        this.#db
          .prepare("UPDATE proposals SET state = ?, decided_by = ?, decided_at = ? WHERE id = ?")
          .run(s.state, s.state === "merged" ? by : null, new Date().toISOString(), p.id);
        this.#systemAudit(
          `proposal_${s.state}`,
          s.state === "merged" ? by : null,
          p.source,
          resource,
        );
        changes++;
      }
    }
    return changes;
  }

  // ---- Skills (published versions only). Access requires the "skills" source.

  listSkills(caller: Caller): SkillInfo[] {
    this.#requireSource(caller, SKILLS_SOURCE, "list_skills");
    this.audit(caller, "list_skills", "ok", SKILLS_SOURCE);
    return (
      this.#db
        .prepare(
          `SELECT s.name, s.version, s.tag, s.status, s.description,
                  (SELECT COUNT(*) FROM skill_files f WHERE f.name = s.name) AS files
           FROM skills s ORDER BY s.status DESC, s.name`,
        )
        .all() as unknown as SkillInfo[]
    ).map((r) => ({ ...r, version: Number(r.version), files: Number(r.files) }));
  }

  #skill(caller: Caller, action: string, name: string): SkillInfo {
    this.#requireSource(caller, SKILLS_SOURCE, action, name);
    const row = this.#db
      .prepare("SELECT name, version, tag, status, description FROM skills WHERE name = ?")
      .get(name) as Omit<SkillInfo, "files"> | undefined;
    if (!row) {
      this.audit(caller, action, "not_found", SKILLS_SOURCE, name);
      throw new NotFoundError();
    }
    return { ...row, version: Number(row.version), files: 0 };
  }

  getSkill(caller: Caller, name: string) {
    const skill = this.#skill(caller, "get_skill", name);
    const files = this.#db
      .prepare(
        "SELECT path, length(content) AS bytes, sha256 FROM skill_files WHERE name = ? ORDER BY path",
      )
      .all(name) as { path: string; bytes: number; sha256: string }[];
    const skillMd = this.#db
      .prepare("SELECT content FROM skill_files WHERE name = ? AND path = 'SKILL.md'")
      .get(name) as { content: string };
    this.audit(caller, "get_skill", "ok", SKILLS_SOURCE, `${skill.tag}`);
    return {
      ...skill,
      files: files.map((f) => ({ ...f, bytes: Number(f.bytes) })),
      instructions: skillMd.content,
    };
  }

  readSkillFile(caller: Caller, name: string, path: string) {
    const skill = this.#skill(caller, "read_skill_file", name);
    const file = this.#db
      .prepare("SELECT content, sha256 FROM skill_files WHERE name = ? AND path = ?")
      .get(name, path) as { content: string; sha256: string } | undefined;
    if (!file) {
      this.audit(caller, "read_skill_file", "not_found", SKILLS_SOURCE, `${skill.tag}:${path}`);
      throw new NotFoundError();
    }
    this.audit(caller, "read_skill_file", "ok", SKILLS_SOURCE, `${skill.tag}:${path}`);
    return { name, version: skill.version, path, ...file };
  }

  /** Everything needed to install a skill locally (used by `skills sync`). */
  skillBundle(caller: Caller, name: string) {
    const skill = this.#skill(caller, "skill_bundle", name);
    const files = this.#db
      .prepare("SELECT path, content, sha256 FROM skill_files WHERE name = ? ORDER BY path")
      .all(name) as { path: string; content: string; sha256: string }[];
    this.audit(caller, "skill_bundle", "ok", SKILLS_SOURCE, skill.tag);
    return { ...skill, files: files.length, contents: files };
  }

  #systemAudit(action: string, actor: string | null, source: string, resource: string) {
    this.#db
      .prepare(
        `INSERT INTO audit (ts, request_id, owner, harness, action, source, resource, result)
         VALUES (?, ?, ?, 'forgejo', ?, ?, ?, 'ok')`,
      )
      .run(new Date().toISOString(), randomUUID(), actor, `forgejo:${action}`, source, resource);
  }
}
