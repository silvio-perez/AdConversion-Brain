// Gateway storage: token registry, append-only audit log and search index.
// Uses Node's built-in SQLite (zero dependencies). Everything else talks to
// the functions below, so swapping to Postgres later touches this file only.
import { DatabaseSync } from "node:sqlite";

export type Store = DatabaseSync;

/**
 * Schema migrations, applied in order and tracked with SQLite's user_version.
 * Never edit a released migration: add a new one.
 */
const MIGRATIONS: string[] = [
  // v1: tokens, audit log, search index (Milestone 2)
  `    CREATE TABLE IF NOT EXISTS tokens (
      id          TEXT PRIMARY KEY,
      hash        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      owner       TEXT NOT NULL,
      harness     TEXT NOT NULL,
      vendor      TEXT NOT NULL,
      sources     TEXT NOT NULL,          -- JSON array of repository names
      mode        TEXT NOT NULL CHECK (mode IN ('read')),
      created_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      revoked_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          TEXT NOT NULL,
      request_id  TEXT NOT NULL,
      token_id    TEXT,
      owner       TEXT,
      harness     TEXT,
      vendor      TEXT,
      action      TEXT NOT NULL,
      source      TEXT,
      resource    TEXT,
      result      TEXT NOT NULL
    );
    -- SEC-AUD-1: the audit log is append-only, enforced by the database itself.
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
      BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
      BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

    CREATE TABLE IF NOT EXISTS sources (
      name        TEXT PRIMARY KEY,
      client      TEXT,
      commit_sha  TEXT NOT NULL,
      indexed_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      source        TEXT NOT NULL,
      path          TEXT NOT NULL,
      revision      TEXT NOT NULL,
      title         TEXT,
      type          TEXT,
      client        TEXT,
      status        TEXT,
      owner         TEXT,
      last_reviewed TEXT,
      frontmatter   TEXT NOT NULL,        -- JSON
      body          TEXT NOT NULL,
      PRIMARY KEY (source, path)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      source UNINDEXED, path UNINDEXED, title, body, tokenize = 'porter unicode61'
    );
  `,
  // v2: proposal tokens and proposal tracking (Milestone 3). SQLite cannot
  // change a CHECK constraint in place, so the tokens table is rebuilt.
  `
    CREATE TABLE tokens_v2 (
      id          TEXT PRIMARY KEY,
      hash        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      owner       TEXT NOT NULL,
      harness     TEXT NOT NULL,
      vendor      TEXT NOT NULL,
      sources     TEXT NOT NULL,
      mode        TEXT NOT NULL CHECK (mode IN ('read', 'propose')),
      created_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      revoked_at  TEXT
    );
    INSERT INTO tokens_v2 SELECT * FROM tokens;
    DROP TABLE tokens;
    ALTER TABLE tokens_v2 RENAME TO tokens;

    CREATE TABLE proposals (
      id            TEXT PRIMARY KEY,
      token_id      TEXT NOT NULL,
      owner         TEXT NOT NULL,
      harness       TEXT NOT NULL,
      vendor        TEXT NOT NULL,
      source        TEXT NOT NULL,
      path          TEXT NOT NULL,
      kind          TEXT NOT NULL CHECK (kind IN ('update', 'new')),
      title         TEXT NOT NULL,
      branch        TEXT NOT NULL,
      pr_number     INTEGER NOT NULL,
      pr_url        TEXT NOT NULL,
      base_revision TEXT,
      created_at    TEXT NOT NULL,
      state         TEXT NOT NULL CHECK (state IN ('open', 'merged', 'closed')),
      approved_by   TEXT,
      decided_by    TEXT,
      decided_at    TEXT
    );
    CREATE INDEX proposals_token_time ON proposals (token_id, created_at);
    CREATE INDEX proposals_open ON proposals (state) WHERE state = 'open';
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function openStore(path: string): Store {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  let version = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
  );
  // Databases created before migrations existed already have the v1 tables.
  if (version === 0 && db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'tokens'").get())
    version = 1;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v] ?? "");
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration to v${v + 1} failed: ${(err as Error).message}`);
    }
  }
  return db;
}
