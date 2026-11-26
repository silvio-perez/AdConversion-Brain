import { describe, expect, it } from "vitest";
import { openStore } from "./store.ts";
import { createToken, listTokens, recheckTokens } from "./tokens.ts";

const base = { harness: "claude-code", vendor: "anthropic", days: 30 } as const;

describe("nightly token recheck (closes the 'left the pod' gap)", () => {
  it("revokes only tokens whose owner lost the access they need, and audits it", async () => {
    const db = openStore(":memory:");
    createToken(db, {
      ...base,
      name: "alice-read",
      owner: "alice",
      sources: ["client-acme-analytics"],
    });
    createToken(db, {
      ...base,
      name: "alice-propose",
      owner: "alice",
      sources: ["company"],
      mode: "propose",
    });
    createToken(db, { ...base, name: "bob-read", owner: "bob", sources: ["client-globex-cloud"] });

    // Alice left the Acme pod; she can still read company knowledge but not write it.
    const access = async (owner: string, source: string) =>
      owner === "alice" && source === "client-acme-analytics"
        ? { read: false, write: false }
        : owner === "alice" && source === "company"
          ? { read: true, write: false }
          : { read: true, write: true };

    const revoked = await recheckTokens(db, access);
    expect(revoked.map((r) => r.reason).sort()).toEqual([
      "alice can no longer propose to company",
      "alice can no longer read client-acme-analytics",
    ]);
    const state = Object.fromEntries(listTokens(db).map((t) => [t.name, !!t.revokedAt]));
    expect(state).toEqual({ "alice-read": true, "alice-propose": true, "bob-read": false });
    const audit = db.prepare("SELECT action, owner, result FROM audit ORDER BY id").all();
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ action: "admin:token_revoked", owner: "alice" });

    // Idempotent: nothing left to revoke.
    expect(await recheckTokens(db, access)).toEqual([]);
  });
});
