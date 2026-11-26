# Milestone 2: Brain Gateway (read-only MCP + REST)

**Status:** Complete (2026-11-26), with one item deferred (see "Not done").

## What was built

| Piece | Where | Purpose |
|---|---|---|
| `Brain` core service | `apps/gateway/src/brain.ts` | The **only** place that decides what a caller may see, and the only place that writes the audit log. |
| MCP endpoint | `mcp.ts`, `/mcp` | 5 read-only tools via the official SDK (Streamable HTTP, stateless). |
| REST API + OpenAPI | `http.ts`, `openapi.ts`, `/v1/*` | Same operations for tools without MCP. |
| Tokens | `tokens.ts` | `brn_` + 256 random bits; hash-only storage; scoped sources; harness + vendor; 90-day cap; revocable. |
| Vendor policy | `config/vendor-policy.json`, `policy.ts` | Which AI vendors may see which client. Checked at token creation **and** on every request. |
| Audit log | `store.ts` | Every read, search, denial and auth failure. Append-only, enforced by database triggers. No document content. |
| Search index | `indexer.ts` | SQLite full-text search, rebuilt per repository when its commit changes (polled every 30s). |
| Read-only Forgejo account | seed script | The gateway reads Git through an account that cannot write. |
| Admin CLI | `pnpm brain ...` | Create, list and revoke tokens; reindex; audit tail. |

## Security properties, and the test that proves each

| Property | Test |
|---|---|
| Another client's data looks exactly like data that doesn't exist (404) | `gateway.test.ts` "returns the same 404..." |
| Path tricks (`../`, URL encoding, case) can't cross clients | "cannot reach another client by path tricks" |
| Search never ranks, snippets or returns out-of-scope documents | "never returns another client's content in search" |
| Every MCP tool is isolation-tested, canary string never appears | "never leaks another client through any tool" |
| A vendor not approved for a client never sees it, even if the token lists it | "vendor policy" suite |
| A token can't exceed its human owner's Forgejo access | live test "refuses a token wider than its owner's" |
| Tokens rejected in URLs, expired, revoked, or after repeated failures | "authentication" suite |
| Audit log can't be edited or deleted | "cannot be edited or deleted" |

**Mutation-tested:** removing the scope filter from search failed 2 tests;
bypassing the vendor policy failed 2 tests. Both were restored.

Totals: 56 unit tests on every push, plus 13 live-stack tests in CI.

## Decisions made during this milestone

1. **SQLite (built into Node) instead of Postgres for gateway storage.** See
   ADR-001 §9. Zero new dependencies; one file to back up. It sits behind
   `store.ts`, so switching to Postgres later is contained.
2. **The index is up to 30 seconds behind Git.** Approved changes appear within
   half a minute. A webhook in Milestone 3 makes it near-instant.
3. **Search queries are stored in the audit log.** Queries are needed for
   investigations, but can contain client terms. The audit log is admin-only and
   stays on our infrastructure.
4. **`zod` and `@hono/node-server`** were added as direct dependencies alongside
   the three you approved. They were already required by the MCP SDK, so the
   installed package count did not change (92).

## Not done

- **Running Claude Code, Codex CLI and Gemini CLI against the gateway.** The
  protocol is verified with the official MCP client, which is what all three
  use, and their configs are documented in `docs/connecting-agents.md`. Actually
  running them needs company accounts for each vendor on a machine that can
  reach the gateway. This is the first task once the Brain runs outside this
  cloud workspace.
- **Token owner re-validation.** If a person leaves a team, their existing agent
  tokens keep working until expiry or revocation. Mitigations now: the 90-day
  cap and `pnpm brain token revoke`. Fix: a scheduled re-check in Milestone 6.

## What you learned (founder notes)

- **One door for security logic.** MCP and REST are thin adapters over one
  service. If isolation lived in each adapter, they would drift apart, and the
  drift is where leaks happen.
- **Scope beats filtering.** Search applies the client scope inside the same
  database query as the match, instead of searching everything and filtering
  afterwards. Nothing out of scope is ever ranked or turned into a snippet that
  could leak.
- **An agent is never more trusted than its human.** Token creation asks Forgejo
  "can this person see this client?" before issuing anything.
- **Vendor policy is code.** "Globex only allows Anthropic" is one line of
  config, enforced on every request and tested.
