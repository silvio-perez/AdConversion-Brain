// The one place that decides what a caller may see (SEC-ISO-3) and records it
// (SEC-AUD-1). MCP and REST are thin adapters over this class, so isolation is
// implemented exactly once.
import { randomUUID } from "node:crypto";
import { type VendorPolicy, vendorAllowed } from "./policy.ts";
import type { Store } from "./store.ts";
import type { TokenRecord } from "./tokens.ts";

export class NotFoundError extends Error {
  constructor() {
    // Identical for "does not exist" and "exists but not yours" (SEC-ISO-4).
    super("Not found");
  }
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
  constructor(db: Store, policy: VendorPolicy) {
    this.#db = db;
    this.#policy = policy;
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
}
