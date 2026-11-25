# Technical Discovery: AdConversion Brain

**Status:** Discovery complete. Awaiting founder review.
**Date:** 2026-11-25
**Subject evaluated:** Baalda (`github.com/naveedharri/baalda`), commit `f80b6b5a` (2026-11-20, tag v0.1.113)
**Reference clone:** `/home/user/reference/baalda`. This is outside this repository on purpose. No Baalda code has been copied into AdConversion Brain.
**Data used:** None. No client or company data was requested, read or processed.

---

## 1. Summary for the founder

Baalda is a well-engineered product, but it solves a different problem from ours.

- **What Baalda is for:** many people editing the same notes live, like Google Docs for markdown files, packaged as a desktop app.
- **What we need:** governed knowledge. Information is proposed, reviewed, approved and audited before it becomes "the truth" that our agents and employees rely on.

Baalda's core design makes every edit instantly canonical. That works against the approval workflow at the heart of our product.

Forking it would mean owning about 350,000 lines of fast-moving code: a Rust desktop app, a code-signing pipeline and a real-time sync engine. We would also still have to build the parts we need most: ingestion, approval, full audit and scoped agent access. The rest of this document gives the evidence.

The best parts of Baalda are its ideas, and we should copy those, not its code:

- the design of its MCP tools (an edit is refused if the note changed since the agent last read it)
- its skills library (draft, publish, pin a version)
- its permission model (access inherits down through folders)

---

## 2. Development environment

This discovery ran in a **cloud development container**, not on Silvio's laptop. Before local work begins we should repeat the check there; see the checklist in `product-roadmap.md` Milestone 0.

| Tool | Found | Needed for | Status |
|---|---|---|---|
| git | 2.43 | Everything | OK |
| Node.js | 22.23 | Gateway service, MCP server | OK |
| pnpm / corepack | 10.28 / 0.36 | Package management | OK |
| Python | 3.13 | Scripts, possible ingestion tooling | OK |
| PostgreSQL client | 16.15 | Database work | OK |
| Docker CLI | 29.9 | Local stack (database, git server) | **The Docker engine is not running in this container.** We need it running locally for Milestone 1. |
| Rust / Cargo | 1.97 | Only if we fork Baalda's desktop app | OK, but not needed for the recommended path |
| Go | 1.24 | Not needed | OK |
| Tauri Linux libraries (`webkit2gtk-4.1`, `libdbus-1-dev`) | Missing | Only to build Baalda's desktop app | **Missing.** Not installed, because installing them would change the system and we may never need them. |

**Conclusion:** no missing prerequisites block the recommended approach, apart from starting the Docker engine on the machine we develop on.

---

## 3. Licensing and rebranding

### 3.1 Baalda's own licenses

| Scope | License | What it means for us |
|---|---|---|
| Everything outside `ee/` | **Apache-2.0** | We may use, modify, self-host and build commercially. We must keep the LICENSE and NOTICE files, mark files we changed, and keep copyright notices. |
| `ee/` directory | **Baalda Enterprise License**, a commercial "source-available" license | Using it in production requires a paid agreement. The folder is **empty today**, but its README reserves it for **SSO/SAML and audit logs**. Those are two of our hard requirements. If we forked and later wanted upstream's versions of those features, we would have to pay or write our own. |
| Name and logo | Trademark policy (`TRADEMARK.md`) | We may not call a fork "Baalda" or "Context". We may say "a fork of Baalda". A fork would need a new name throughout. |

### 3.2 Third-party dependencies

Transitive license scan of the code shipped in production: `pnpm licenses list --prod` for JavaScript and `cargo metadata` for Rust. Dependencies were installed into the reference clone only, with install scripts turned off.

- **JavaScript (about 430 packages):** MIT 313, ISC 40, Apache-2.0 32, BSD 17, and smaller permissive licenses.
  - Three packages reported "Unknown" or "UNLICENSED" (`@polar-sh/sdk`, `khroma`, `@sesamecare-oss/redlock`). All three are MIT once you read their actual license files; the package metadata is simply incomplete.
- **Rust (619 crates):** almost all are MIT or Apache-2.0.
  - 5 crates are **MPL-2.0** (`cssparser`, `selectors` and others). That license is copyleft only for the files themselves, so it is fine as long as we don't modify those crates.
  - 1 crate is CDLA-Permissive-2.0.
- **Attribution needed:** DiceBear avatar art (CC-BY-4.0) and bundled fonts (OFL-1.1).
- **No GPL or AGPL in the production dependency tree.** `jszip` is offered under MIT or GPL, and we would pick MIT.

**Verdict:** the licenses permit a fork. The restrictions that matter are the trademark and the `ee/` boundary.

### 3.3 Rebranding effort (only if we fork)

| Item | Count |
|---|---|
| Occurrences of "baalda" | About 1,716 across the repo; about 1,281 of them in about 328 files under `app/` |
| `baalda://` URL scheme | 165 references |
| `baalda-view` protocol | 28 references |
| `BAALDA_*` environment variables | 7 or more |
| Bundle ID and keychain service | `com.baalda.context` |

- **Visible-only rebrand:** about 1 day.
- **Full rebrand:** about 3 to 5 days. This includes bundle ID, URL schemes, environment variable names, updater and CI re-homing, and regression testing of deep links and OAuth.

Baalda's own `BRANDING.md` claims "under an hour". That is not accurate.

---

## 4. Architecture of Baalda

```
 Desktop app (Tauri 2: Rust core + React/CodeMirror UI)
   .md files on disk  <-- watcher / diff -->  Yjs CRDT document (live)
                                                   |
                                    WebSocket (binary Yjs updates)
                                                   v
 Server (Node/TS): Hono HTTP + Hocuspocus sync + Better Auth + MCP endpoint
                                                   |
                                                   v
 Postgres: Yjs update log + snapshots, plain-text search index,
           note versions, permissions, skills (bytea), access audit
           Optional: Redis (multiple servers), S3/MinIO (attachments)
```

### 4.1 Size

| Measure | Value |
|---|---|
| TypeScript | About 320k lines |
| Rust | About 29k lines |
| CSS | About 23k lines |
| Test files | About 617 |
| Database migrations | 87 |

### 4.2 How it works

- **Sync engine:** a "CRDT" (conflict-free replicated data type) lets several people type in the same document at once and have their edits merge automatically.
  - Each desktop client converts changes on disk into CRDT operations, and the reverse.
  - The server stores the CRDT's binary history.
  - **Every accepted edit is immediately live for everyone.**
- **Clients:** desktop only (macOS, Windows, Linux). There is **no web app**. The server renders only login and account pages and read-only public links.
- **Headless access:** the server can read and write notes without a desktop client running (`mcp/doc-writer.ts`). An ingestion worker could therefore write through MCP.
- **REST API:** one exists (notes, folders, files, versions, skills, shares). It is internal, undocumented and changes often.

### 4.3 Maturity and maintenance signals

| Signal | Value |
|---|---|
| Age | 4 months (first commit 2026-07-14) |
| Commits | 1,698; 1,470 in the last 90 days |
| Lines added in the last 90 days | About 805,000, which strongly suggests heavy AI-generated code |
| Main maintainer's share of commits | About 86% (one person) |
| Version | Still 0.1.x |
| Releases | 105 tagged; several per week |

**What this means for a fork:** merging upstream changes would be painful. Churn is concentrated in the core files (sync, permissions, crypto), and database migrations are numbered in a single sequence, so our own migrations would collide with theirs.

---

## 5. External services, telemetry and cloud dependencies

**Good news:** no analytics, crash reporting or license check was found.

**Problems:** the desktop app **defaults to the vendor's servers** in two places, and both require code changes to fix.

| Dependency | Default | Risk | Fix |
|---|---|---|---|
| **Managed server `api.baalda.com`** (`desktop/src/lib/api.ts:74`) | **On in release builds.** The first-run screen offers "managed" as the default. | **High.** One wrong click sends credentials and client knowledge to a third party. | Rebuild with our server URL and remove the "managed" option. |
| **Desktop auto-updater** (`tauri.conf.json:54-58`) | **On.** Checks the vendor's GitHub every 15 minutes, installs silently and restarts the app. | **High.** The vendor's signing key can push new code onto our machines. | Replace it with our own signing key and update feed, or remove the updater. |
| Server release check, GitHub (`sync/release-watch.ts`) | On | Low (it leaks only the server's IP address) | Set `RELEASE_MANIFEST_URL=off`. |
| Polar billing | Off unless a token is set | Low | Leave unset. Set `BAALDA_DEPLOYMENT=self-hosted`, or a 20,000-notes-per-vault cap stays active. |
| Resend email / Google OAuth / S3 | Off unless configured | Low | Use our own SMTP and storage. |
| "Assistant" (runs the user's local Claude Code / Codex CLI) | Started by the user | **Medium.** Data goes to the AI vendor under that employee's personal account, outside company policy. | Remove it in code. |
| MCP connectors for claude.ai and ChatGPT | The endpoint is always served | Medium | Block at the proxy or remove. There is no config switch. |
| Dashboard CDNs (cdnjs, jsdelivr, unpkg, Google Fonts), skills marketplace (GitHub), remote dashboards | Fire when a user uses the feature | Low to medium | Change the content security policy, or remove the feature. |
| Container images (`ghcr.io`, `quay.io`) | Used at deploy time | Low | Build from source and mirror the images. |

**Can it run entirely on infrastructure we control?** Yes, **but only after code changes and a self-built, self-signed desktop app.**

- The server on its own runs with no internet access.
- The desktop app as distributed is not acceptable for client data.

---

## 6. Security evaluation

All findings below were confirmed against the source code. File references are relative to `app/apps/server/src/`.

### 6.1 Authentication

- **Methods:** email and password (hashed with argon2id), and optionally Google OAuth.
- **No SSO, SAML or OIDC** with our own identity provider.
- **No two-factor authentication.**
- **Email verification is off** (`auth/auth.ts:139`), and **anyone can sign up**.
- Google sign-in links to an existing account with the same email without verifying it.
- Failed sign-ins lock the account after 5 failures in 15 minutes.
- Sessions last 30 days and slide daily.

### 6.2 Authorization and client isolation

- **Structure:** organization ("vault"), then nested folders, then notes and files.
- **Permission rules:** access levels are view or edit, and the highest grant wins.
  - Folder grants pass down to everything inside.
  - There are deny overrides and locks.
  - New vaults are *Shared* by default, not private.
- **Where the checks happen:** the HTTP API, the sync WebSocket (re-checked on every connect, and it fails closed), MCP and downloads. This is consistent and well tested, including "red-team" test suites.
- **Isolation exists in application code only.**
  - There is no database-level tenant isolation (no Postgres row-level security), and no separate database per tenant.
  - The only hard boundary is one vault (organization) per client. Folder-per-client is soft isolation.
- **Ways to bypass normal access:**
  - unauthenticated public links
  - join codes that never expire and have no rate limit
  - an attachment check based on matching text in notes, which we believe can leak files inside one vault (unconfirmed)

### 6.3 MCP (agent access)

- **Implementation:** hand-written JSON-RPC over HTTP rather than the official SDK. There are 26 tools: read, search, create, edit, append, move, delete, access management, and skills.
- **Strengths:**
  - edits are refused if the note changed since the agent read it (revision preconditions)
  - repeated requests aren't applied twice (idempotency keys)
  - agents get the same permission checks as humans
- **Weaknesses that matter for us:**
  - **Tokens have no expiry, no read-only scope and no per-client scope.** A token can do anything its human owner can.
  - **Tokens are accepted in the URL** (`http/routes/mcp.ts:132-138`), so they end up in proxy and server logs.
  - Edits made by an agent are not marked as coming from an agent.
  - An agent acting for an admin can change permissions.

### 6.4 Version history and audit

| Capability | Baalda has | We need |
|---|---|---|
| Content history | Up to 50 snapshots per note, taken after an editing session goes idle; older ones are pruned (`versions/capture.ts:50`) | Complete, permanent, line-level history |
| Rollback | Vault checkpoints and per-note revert | Same |
| Audit log | **Only permission and membership changes** (`migrations/056`) | Every read, write, proposal, approval and token use, especially by agents |
| Deletion | "Deleted means deleted"; the server-side trash was removed | Recoverable |

### 6.5 Data at rest

- By default the server stores **plain text** copies (search index, versions) next to the CRDT binary.
- Optional "vault keys" encrypt data at rest using keys held by clients. This is not end-to-end encryption: the server decrypts in memory whenever MCP or search runs.
- That is reasonable, but it adds key-management complexity for headless agents.

---

## 7. Fit against our requirements

| Requirement | Baalda today | Gap size |
|---|---|---|
| Company knowledge as markdown | Yes | None |
| Isolated per-client knowledge bases | Yes, via one vault per client (isolation in application code only) | Small |
| Version-controlled skills library | **Yes. This is the best feature to learn from.** Draft, publish an immutable version, pin, mark required, install to `~/.claude/skills`. | Small |
| Ingestion (Grain, documents) | No | Large |
| Human review and approval | **No, and the architecture fights it** (every edit is live) | **Large** |
| MCP and API | Yes, but tokens are coarse | Medium |
| Granular permissions | Yes (folder ACL) | Small to medium |
| Version history and audit logs | Partial (capped history, access-only audit, paid tier reserved upstream) | Medium to large |
| Model and agent-harness agnostic | Yes (plain markdown plus MCP) | None |
| Our infrastructure only | Only after code changes and our own desktop build and signing | Medium |
| Low maintenance | **No.** About 350k lines, a desktop signing pipeline, a CRDT engine, a single-maintainer upstream | **Large** |
| Web access for staff | **No web client** | Large |

### 7.1 Worth reusing (as patterns, not code)

1. **MCP tool design:**
   - `read_note` returns a revision, and writes must pass `expectedRevision`
   - idempotency keys
   - targeted `edit_note` at exact anchors instead of rewriting the whole file
2. **Skills model:**
   - `SKILL.md` with frontmatter
   - an immutable published version with release notes
   - admin can pin a version, and mark skills required or optional
   - distribution to `~/.claude/skills` and `~/.agents/skills`
3. **Permission resolver semantics:** inherited folder grants, highest grant wins, explicit deny.
4. **Red-team style permission tests.**

### 7.2 Gaps we would build regardless of approach

- Ingestion pipeline (Grain → transcript → extraction → proposal)
- Proposal, review and approval workflow
- Full audit log
- Scoped, expiring agent tokens
- SSO with our identity provider
- A web interface for reviewers
