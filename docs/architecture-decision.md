# ADR-001: Foundation for AdConversion Brain

**Status:** PROPOSED. Awaiting founder approval. Nothing will be built until this is approved.
**Date:** 2026-11-25
**Evidence:** `docs/technical-discovery.md`

---

## 1. The decision we're making

Should AdConversion Brain be:

- **(A)** a minimal Baalda fork,
- **(B)** a new system that lifts selected Baalda components, or
- **(C)** a simpler greenfield system that reuses mature open-source building blocks?

## 2. The insight that drives the decision

There are two fundamentally different models for shared knowledge.

| | **Live-collaboration model** (Baalda, Google Docs, Notion) | **Governed model** (Git, Wikipedia, legal docs) |
|---|---|---|
| A change becomes truth | The moment it is typed | When a reviewer approves it |
| History | Snapshots | Every change, who made it, why, and who approved it |
| Best for | Brainstorming, drafting together | Canonical knowledge that others depend on |

AdConversion Brain is a **governed** system. Its value is that agents and employees can *trust* what they read.

- An ingestion agent that misreads a Grain call should produce a *proposal*, not silently rewrite a client's positioning doc.
- That is the core of "human-supervised reconciliation".

Baalda is built on the live model. The workflow we need most would fight its central mechanism.

---

## 3. Options

### Option A: minimal Baalda fork

Rebrand it, strip the vendor defaults (managed server, auto-updater), deploy the server ourselves, ship our own signed desktop app, then add what's missing.

| Work item | Rough effort with AI-assisted development |
|---|---|
| Rebrand, remove vendor defaults, own CI and signing (Apple and Windows certificates) | 1–2 weeks |
| Security hardening: scoped and expiring tokens, SSO/OIDC, email verification, token-in-URL fix | 2–3 weeks |
| Full content audit log | 1–2 weeks |
| Proposal and approval workflow on top of a live CRDT | 3–5 weeks, high risk |
| Ingestion pipeline | 2–3 weeks |
| Web interface for reviewers (none exists) | 2–4 weeks |
| **Total to MVP** | **About 11–19 weeks** |
| **Then** | We own about 350k lines, a desktop release pipeline and a CRDT sync engine, forever |

**Pros:**

- Polished editor and real-time collaboration on day one.
- Mature permission model.
- Skills library built in.

**Cons:**

- The highest maintenance cost by far.
- Every staff member needs a desktop app we must sign, update and support.
- The approval workflow goes against the architecture.
- Upstream is a single maintainer moving very fast, so we'd effectively freeze our copy and lose their updates.
- Audit and SSO are reserved for upstream's paid tier.

### Option B: modular reuse of Baalda components

Take only the server pieces we like (MCP layer, permission resolver, skills catalog) and build around them.

**Pros:** reuses tested permission and skills logic.

**Cons:**

- Those modules are tightly coupled to Yjs/Hocuspocus document storage, Better Auth organizations and Baalda's 87-migration schema.
- Extracting them means untangling most of the server. In practice you inherit the complexity without the editor that justified it.
- We estimate it costs about the same as Option C while producing something harder to understand.

**Verdict:** the worst of both worlds. Reuse Baalda's *designs*, not its modules.

### Option C: greenfield, built on Git and a self-hosted Git server (RECOMMENDED)

Make **Git the source of truth** and add a small service of our own for agents.

```
                Staff (browser)                     AI agents / harnesses
                     |                    (Claude Code, Cowork, custom agents,
                     |                          any model) via MCP or REST
                     v                                        |
       +-----------------------------+          +-------------v------------+
       |  Forgejo (self-hosted Git)  |<-------->|   Brain Gateway (ours)   |
       |  - one repo per client      |  git +   |  - MCP server + REST API |
       |  - company repo, skills     |   API    |  - scoped, expiring keys |
       |  - web editor, PR review    |          |  - search index          |
       |  - SSO, teams, history      |          |  - audit log (all reads  |
       +-------------^---------------+          |    and writes)           |
                     |  opens pull requests     |  - writes = proposals    |
       +-------------+---------------+          +--------------------------+
       |  Ingestion worker (ours)    |                       |
       |  Grain / docs -> LLM ->     |                  Postgres
       |  proposed changes + sources |           (index, audit, tokens)
       +-----------------------------+
            All in one AdConversion-controlled environment (Docker Compose)
```

#### Why each piece

1. **Git as the source of truth.** Git already provides:
   - complete, permanent history (who changed what, when, and why)
   - branches, so a change can exist as a *proposal* before it's accepted
   - pull requests, so a reviewer approves it; this *is* our reconciliation workflow
   - trivial backup (every clone is a full copy)
   - plain markdown that any tool or model can read

   We get version history, audit of content changes, and the approval workflow **without writing them**.

2. **Forgejo as the Git server.** Forgejo is an open-source, self-hosted equivalent of GitHub: a single Go binary plus Postgres. It gives staff:
   - a browser UI to read, edit and review markdown
   - SSO (OIDC with Google Workspace)
   - team and per-repository permissions
   - two-factor authentication
   - webhooks

   **One repository per client gives hard isolation.** A person or agent either has access to the repo or doesn't. That is easier to reason about and audit than folder ACLs.

   Forgejo is GPL-3.0. Running it unmodified for internal use creates no obligations for our own code. Gitea (MIT) is an equivalent alternative.

3. **Brain Gateway (our code, small, TypeScript).** This is the one place agents connect to. It owns:
   - **MCP and REST**, using the official MCP SDK. Tool design borrows Baalda's best ideas: revision preconditions, targeted edits, idempotency.
   - **Agent identity.** Every token is scoped to specific clients, read or propose, and an expiry date. It is never accepted in a URL.
   - **Writes as proposals.** Agents cannot change canonical knowledge directly. `propose_change` opens a branch and a pull request for a human to approve.
   - **Audit log.** Every read and write by every person and agent goes into an append-only table.
   - **Search.** Postgres full-text search first; semantic search (pgvector) when it proves necessary.
   - **Skills endpoint.** Skills live in a `skills` repo, with Git tags as immutable versions. That borrows Baalda's draft → publish → pin model, using Git instead of custom tables.

4. **Ingestion worker (our code).**
   - It pulls new Grain recordings and maps each one to a client.
   - It extracts candidate learnings with an LLM.
   - It compares them against the existing knowledge base.
   - It opens a pull request with the proposed edits and **source citations** (meeting, timestamp).
   - A human approves, edits or rejects it.

5. **Model-agnostic by construction.**
   - Knowledge is markdown.
   - Access is MCP or REST.
   - The ingestion worker calls LLMs through a thin adapter, so changing providers is a config change.

#### Effort

| Milestone | Effort |
|---|---|
| Local stack + repository structure + synthetic data | 1 week |
| Gateway: read-only MCP, scoped tokens, audit log | 2 weeks |
| Proposals via pull requests | 1–2 weeks |
| Skills library | 1 week |
| Ingestion v1 | 2–3 weeks |
| **Total to MVP** | **About 7–9 weeks** |

**Code we own:** an estimated 5–10k lines, plus well-maintained infrastructure we run but don't maintain.

**Pros:**

- Smallest codebase.
- The hardest features come for free from Git.
- Hard per-client isolation.
- Browser access with no desktop app to sign and distribute.
- Easiest to audit and explain to a client's security team.
- Portable: if we abandon our code, the knowledge is still a folder of markdown files in Git.

**Cons and honest risks:**

- **No live co-editing with cursors.** We judge that acceptable: canonical knowledge should not be co-typed in real time. Drafting can happen anywhere (Google Docs, Claude, Obsidian) and land as a proposal.
- **Git concepts can intimidate non-technical staff.** We mitigate by hiding Git behind Forgejo's web editor and plain-language pull requests ("Proposed update to Acme brand guidelines"). If adoption suffers, we build a simple review screen in Phase 2.
- **We run Forgejo and Postgres ourselves.** That is ordinary operations: backups, updates. It is much lighter than owning a sync engine.

---

## 4. Scoring

Scores out of 5, where 5 is best.

| Criterion (weight) | A: Fork | B: Modular | C: Greenfield + Git |
|---|---|---|---|
| Privacy / control (30%) | 3: needs code surgery and our own signed desktop app | 3 | **5**: no client software, nothing calls out by default |
| Development speed to MVP (20%) | 2: 11–19 weeks | 2 | **4**: 7–9 weeks |
| Maintainability (30%) | 1: 350k lines, single-maintainer upstream | 2 | **5**: about 5–10k lines of ours |
| Extensibility (20%) | 3 | 2 | **4**: plain Git and markdown, standard APIs |
| **Weighted** | **2.2** | **2.3** | **4.6** |

## 5. Recommendation

**Adopt Option C.** Treat Baalda as a design reference.

Specifically, we copy (with attribution where text or code is adapted, per Apache-2.0):

- its MCP tool contract
- its skills versioning model
- its permission-resolution semantics

**When would I change this recommendation?** If, after using the Phase 1 MVP, the team finds that real-time co-editing of knowledge is essential, we can add it locally without changing the core: staff can edit their Git checkouts in Obsidian or VS Code. Baalda's local-first design also means it could be pointed at a checkout later as an editor.

---

## 6. Decisions I need from you before building

These are consequential, so I'm asking rather than assuming.

1. **Approve Option C** (or push back).

2. **Where Git lives:**
   - **(a) Self-hosted Forgejo** (recommended): full control, meets "AdConversion-controlled infrastructure" literally.
   - **(b) Private GitHub organization:** zero operations and familiar, but client knowledge would sit on GitHub's servers.

3. **Hosting location for the stack:** a VM in a cloud account AdConversion owns (for example AWS or Hetzner, in your preferred region), reached over VPN or SSO only. I will not deploy anything without explicit approval.

4. **LLM data policy for ingestion.** Ingestion means sending transcript text to a model. Options:
   - **(a)** Anthropic or OpenAI API under business terms with zero data retention
   - **(b)** models inside our own cloud account (for example AWS Bedrock)
   - **(c)** self-hosted open models

   Recommended: (a) or (b), with approved providers listed in config and enforced by the gateway. This is also a contract question: check what our client MSAs say about subprocessors.

5. **Identity provider:** Google Workspace sign-in for staff (assumed).
