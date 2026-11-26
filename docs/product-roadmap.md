# Product Roadmap: AdConversion Brain

**Status:** Active. Option C was accepted on 2026-11-26 (see ADR-001 §7).
**Date:** 2026-11-25

**Principles:**

- Small, testable milestones.
- Synthetic data until the security gate.
- Each milestone ends with something you can use and a short "what you learned" note, since this project is also a learning vehicle.

---

## Phase 0: Discovery (DONE, approved 2026-11-26)

Deliverables:

- `technical-discovery.md`
- `architecture-decision.md`
- `security-requirements.md`
- this roadmap

**Gate:** founder approves an option and answers the five decisions listed in ADR-001 §6.

---

## Phase 1: MVP, "a trustworthy brain agents can read" (about 7–9 weeks)

### Milestone 0: Environment (2–3 days) ✅ Done 2026-11-26 (see `docs/milestones/m0-environment.md`)

**Work:**

- Repeat the prerequisite check on the actual development machine: Node 22, pnpm, Docker engine **running**, git.
- Repository scaffolding: monorepo layout, lint, format, tests, CI.
- License scan and dependency audit in CI (SEC-SUP-1, SEC-SUP-2).

**Done when:** `pnpm test` passes in CI on an empty project.

**Teaches:** why a monorepo, what CI is protecting you from.

### Milestone 1: Local stack and knowledge structure (1 week) ✅ Done 2026-11-26 (see `docs/milestones/m1-local-stack.md`)

**Work:**

- Docker Compose with Forgejo, Postgres and a reverse proxy, running **locally only**.
- Repository conventions, documented:
  - `company/`: methodologies, SOPs
  - `skills/`
  - one `client-<slug>` repo per client (synthetic: "Acme Analytics" and "Globex Cloud")
- Markdown conventions: frontmatter schema (owner, status, last reviewed, sources), folder layout per client (business context, product marketing, brand, design system, strategy, learnings).
- A synthetic data generator.

**Done when:** both synthetic clients are browsable in Forgejo, and a Forgejo user can see one client repo and not the other.

**Teaches:** Git as a database, why repo-per-client gives hard isolation.

### Milestone 2: Brain Gateway, read-only MCP (2 weeks) ✅ Done 2026-11-26 (see `docs/milestones/m2-gateway.md`)

**Work:**

- TypeScript service using the official MCP SDK.
- Tools: `list_clients`, `list_documents`, `read_document` (returns a revision), `search`.
- Postgres full-text index, rebuilt from Git on each push via webhook.
- Agent tokens: scoped, expiring, header-only, stored as hashes (SEC-AUTH-3 to SEC-AUTH-5).
- Append-only audit log (SEC-AUD-1, SEC-AUD-2).
- **Isolation test suite** (SEC-ISO-4).

- A REST API with a generated OpenAPI spec, sharing the same backend as MCP.

**Done when:**

- A scripted conformance suite passes from **Claude Code, OpenAI Codex CLI and Gemini CLI**: answering questions about Acme with a token that cannot see Globex.
- Every access appears in the audit log, labelled by harness and vendor.

**Teaches:** what MCP actually is, how token scoping works.

### Milestone 3: Proposals and approval (1–2 weeks)

**Work:**

- MCP tools `propose_change` and `propose_document`, which create a branch and a pull request with source metadata (SEC-INT-1, SEC-INT-2).
- Revision preconditions, modelled on Baalda (SEC-INT-5).
- Protected default branches.
- A plain-language PR template for reviewers.

**Done when:** an agent proposes an update, a reviewer approves it in the browser, and the index and audit log reflect it.

**Teaches:** why governed knowledge beats live editing for agents.

### Milestone 4: Skills library (1 week)

**Work:**

- A `skills` repo using the `SKILL.md` folder convention.
- Releases are Git tags (immutable versions), with a "required or optional" manifest.
- MCP and REST `list_skills`/`get_skill`, plus a sync script that installs approved versions for every harness: `~/.claude/skills`, `~/.agents/skills` (Codex), and a Gemini CLI extension.

**Done when:** a skill is edited, reviewed, released as v2, and staff pick up v2 with one command.

### Milestone 5: Ingestion v1, Grain (2–3 weeks)

**Work:**

- A worker polls Grain for new recordings, maps each to a client (by Grain company or tag), and pulls the transcript.
- LLM extraction through a provider adapter (Bedrock/Claude by default; Vertex/Gemini, OpenAI and local models as alternatives), restricted to the approved list (SEC-EGR-3). A synthetic evaluation set compares providers before any switch.
- Prompts treat the transcript as untrusted data (SEC-INT-3).
- The worker compares against the current knowledge base and opens **one pull request per meeting**, with proposed edits and citations (meeting, timestamp, quote).
- Developed entirely against **synthetic transcripts**.

**Done when:** a synthetic Acme call produces a sensible, cited pull request, and a prompt-injection test transcript produces nothing harmful.

### Milestone 6: Security gate and pilot (1 week + pilot)

**Work:**

- Production deployment to approved AdConversion infrastructure (**requires explicit approval**).
- SSO, a default-deny network, backups with a tested restore.
- Review against every MUST in `security-requirements.md`.

**Pilot:** company knowledge plus **one** real client, with a small team, for 2–4 weeks.

**Done when:** every MUST is checked off and the pilot team uses it weekly.

---

## Phase 2: Adoption and scale (after the pilot)

- A public, OAuth-protected MCP endpoint so the cloud apps (claude.ai, ChatGPT, the Gemini app) can connect. Needs a separate approval.
- Ingestion from Google Drive and Docs, Slack summaries and ClickUp (each new source is a new approved egress path).
- Semantic search (pgvector) if full-text search proves insufficient.
- A lightweight review inbox UI if Forgejo's pull request UI creates friction for non-technical reviewers.
- "Collective intelligence": anonymized promotion of client learnings to company-level knowledge, via approved proposals (SEC-ISO-5).
- Staleness alerts (documents not reviewed in 90 days), and owners per document.
- Audit dashboards and anomaly alerts (SEC-AUD-4).

## Phase 3: Leverage

- Agents that run on the Brain: MBR drafts, ad copy and audits grounded in client knowledge (many existing AdConversion skills become consumers).
- Possible productization for the Academy or Sami: licensed frameworks delivered as a read-only skills and methodology repo. This is a business decision for later. The architecture keeps it open because IP lives in separate repos.

---

## Explicitly out of scope for Phase 1

- Real-time co-editing with live cursors
- A desktop app
- Mobile apps
- Public sharing links
- Billing
- Any real client data before Milestone 6
