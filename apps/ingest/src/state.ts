// Remembers which meetings were already handled, so runs are idempotent.
// Stores meeting ids and outcomes only, never transcript text.
import { DatabaseSync } from "node:sqlite";

export type Outcome = "proposed" | "no_learnings" | "error";

export class IngestState {
  readonly #db: DatabaseSync;
  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY, client TEXT, outcome TEXT NOT NULL, detail TEXT, processed_at TEXT NOT NULL)`);
  }
  done(id: string): boolean {
    const row = this.#db.prepare("SELECT outcome FROM meetings WHERE id = ?").get(id) as
      | { outcome: string }
      | undefined;
    return !!row && row.outcome !== "error"; // errors are retried next run
  }
  record(id: string, client: string, outcome: Outcome, detail: string) {
    this.#db
      .prepare(
        `INSERT INTO meetings (id, client, outcome, detail, processed_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET outcome = excluded.outcome, detail = excluded.detail, processed_at = excluded.processed_at`,
      )
      .run(id, client, outcome, detail, new Date().toISOString());
  }
}
