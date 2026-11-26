import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Store } from "./store.ts";

export const TOKEN_PREFIX = "brn_";
export const MAX_TOKEN_DAYS = 90; // SEC-AUTH-4

/** read: look things up. propose: also open proposals for human review. */
export type TokenMode = "read" | "propose";

export interface TokenRecord {
  id: string;
  name: string;
  owner: string;
  harness: string;
  vendor: string;
  sources: string[];
  mode: TokenMode;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface NewToken {
  name: string;
  owner: string;
  harness: string;
  vendor: string;
  sources: string[];
  days: number;
  mode?: TokenMode;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Create a token. The plaintext is returned once and never stored (SEC-AUTH-5). */
export function createToken(
  db: Store,
  input: NewToken,
  now = new Date(),
): { token: string; record: TokenRecord } {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_TOKEN_DAYS)
    throw new Error(`days must be between 1 and ${MAX_TOKEN_DAYS}`);
  if (input.sources.length === 0) throw new Error("a token needs at least one source");
  for (const field of ["name", "owner", "harness", "vendor"] as const)
    if (!input[field]?.trim()) throw new Error(`${field} is required`);

  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const record: TokenRecord = {
    id: randomUUID(),
    name: input.name,
    owner: input.owner,
    harness: input.harness,
    vendor: input.vendor,
    sources: [...new Set(input.sources)].sort(),
    mode: input.mode ?? "read",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + input.days * 86_400_000).toISOString(),
    revokedAt: null,
  };
  db.prepare(
    `INSERT INTO tokens (id, hash, name, owner, harness, vendor, sources, mode, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    hashToken(token),
    record.name,
    record.owner,
    record.harness,
    record.vendor,
    JSON.stringify(record.sources),
    record.mode,
    record.createdAt,
    record.expiresAt,
  );
  return { token, record };
}

interface TokenRow {
  id: string;
  name: string;
  owner: string;
  harness: string;
  vendor: string;
  sources: string;
  mode: TokenMode;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

const toRecord = (r: TokenRow): TokenRecord => ({
  id: r.id,
  name: r.name,
  owner: r.owner,
  harness: r.harness,
  vendor: r.vendor,
  sources: JSON.parse(r.sources) as string[],
  mode: r.mode,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
});

/** Returns the token's record if it is valid right now, otherwise null. */
export function verifyToken(db: Store, token: string, now = new Date()): TokenRecord | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = db.prepare("SELECT * FROM tokens WHERE hash = ?").get(hashToken(token)) as
    | TokenRow
    | undefined;
  if (!row || row.revoked_at || new Date(row.expires_at) <= now) return null;
  return toRecord(row);
}

export function revokeToken(db: Store, id: string, now = new Date()): boolean {
  const res = db
    .prepare("UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(now.toISOString(), id);
  return Number(res.changes) > 0;
}

export function listTokens(db: Store): TokenRecord[] {
  return (
    db.prepare("SELECT * FROM tokens ORDER BY created_at").all() as unknown as TokenRow[]
  ).map(toRecord);
}

export type AccessLookup = (
  owner: string,
  source: string,
) => Promise<{ read: boolean; write: boolean }>;

/**
 * Revoke tokens whose owner no longer has the access the token assumes (for
 * example, they left a pod). Run nightly. Returns what was revoked and why.
 */
export async function recheckTokens(
  db: Store,
  access: AccessLookup,
  now = new Date(),
): Promise<{ id: string; owner: string; reason: string }[]> {
  const revoked: { id: string; owner: string; reason: string }[] = [];
  const active = listTokens(db).filter((t) => !t.revokedAt && new Date(t.expiresAt) > now);
  const cache = new Map<string, { read: boolean; write: boolean }>();
  for (const t of active) {
    let reason: string | null = null;
    for (const source of t.sources) {
      const key = `${t.owner}\u0000${source}`;
      const a = cache.get(key) ?? (await access(t.owner, source));
      cache.set(key, a);
      if (!a.read) reason = `${t.owner} can no longer read ${source}`;
      else if (t.mode === "propose" && !a.write)
        reason = `${t.owner} can no longer propose to ${source}`;
      if (reason) break;
    }
    if (!reason) continue;
    revokeToken(db, t.id, now);
    db.prepare(
      `INSERT INTO audit (ts, request_id, token_id, owner, harness, vendor, action, resource, result)
       VALUES (?, ?, ?, ?, ?, ?, 'admin:token_revoked', ?, ?)`,
    ).run(now.toISOString(), randomUUID(), t.id, t.owner, t.harness, t.vendor, t.name, reason);
    revoked.push({ id: t.id, owner: t.owner, reason });
  }
  return revoked;
}
