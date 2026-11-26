// Gateway storage: token registry, append-only audit log and search index.
// Uses Node's built-in SQLite (zero dependencies). Everything else talks to
// the functions below, so swapping to Postgres later touches this file only.
import { DatabaseSync } from "node:sqlite";

export type Store = DatabaseSync;

export function openStore(path: string): Store {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS tokens (
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
  `);
  return db;
}
