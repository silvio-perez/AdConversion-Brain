import { expectedClient, splitFrontmatter } from "@brain/knowledge";
import type { ContentSource } from "./content.ts";
import type { Store } from "./store.ts";

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Bring the search index up to date. Only repositories whose commit changed are
 * re-read, and each repository is replaced atomically in one transaction.
 */
export async function syncIndex(db: Store, source: ContentSource): Promise<string[]> {
  const known = new Map(
    // Rows with "#" are bookkeeping for other syncs (e.g. skills#releases), not repositories.
    (
      db.prepare("SELECT name, commit_sha FROM sources WHERE name NOT LIKE '%#%'").all() as {
        name: string;
        commit_sha: string;
      }[]
    ).map((r) => [r.name, r.commit_sha]),
  );
  const heads = await source.heads();
  const updated: string[] = [];

  for (const head of heads) {
    if (known.get(head.name) === head.commitSha) continue;
    const snap = await source.snapshot(head.name, head.commitSha);
    const docs = await Promise.all(
      snap.files.map(async (f) => {
        const text = await f.read();
        const split = splitFrontmatter(text);
        const fm = (split?.data && typeof split.data === "object" ? split.data : {}) as Record<
          string,
          unknown
        >;
        return { ...f, fm, body: split ? split.body : text };
      }),
    );
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM documents WHERE source = ?").run(head.name);
      db.prepare("DELETE FROM documents_fts WHERE source = ?").run(head.name);
      const insDoc = db.prepare(
        `INSERT INTO documents (source, path, revision, title, type, client, status, owner, last_reviewed, frontmatter, body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insFts = db.prepare(
        "INSERT INTO documents_fts (source, path, title, body) VALUES (?, ?, ?, ?)",
      );
      for (const d of docs) {
        const title = str(d.fm.title) ?? str(d.fm.name) ?? d.path;
        insDoc.run(
          head.name,
          d.path,
          d.revision,
          title,
          str(d.fm.type),
          str(d.fm.client),
          str(d.fm.status),
          str(d.fm.owner),
          str(d.fm.last_reviewed),
          JSON.stringify(d.fm),
          d.body,
        );
        insFts.run(head.name, d.path, title, d.body);
      }
      db.prepare(
        `INSERT INTO sources (name, client, commit_sha, indexed_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET client = excluded.client, commit_sha = excluded.commit_sha, indexed_at = excluded.indexed_at`,
      ).run(head.name, expectedClient(head.name), head.commitSha, new Date().toISOString());
      db.exec("COMMIT");
      updated.push(head.name);
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // Repositories that disappeared from the source are removed from the index.
  const live = new Set(heads.map((h) => h.name));
  for (const name of known.keys())
    if (!live.has(name)) {
      db.prepare("DELETE FROM documents WHERE source = ?").run(name);
      db.prepare("DELETE FROM documents_fts WHERE source = ?").run(name);
      db.prepare("DELETE FROM sources WHERE name = ?").run(name);
      updated.push(name);
    }
  return updated;
}
