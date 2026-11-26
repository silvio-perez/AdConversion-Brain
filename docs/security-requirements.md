# Security Requirements: AdConversion Brain

**Status:** Accepted with ADR-001 (2026-11-26).
**Date:** 2026-11-25

These requirements apply whichever foundation is chosen. Each requirement has an ID so tests and code can reference it.

**Keywords:**

- **MUST:** required for launch.
- **SHOULD:** expected unless there is a documented reason not to.
- **LATER:** planned for after the MVP.

---

## 1. Threat model (plain English)

What we are protecting:

1. **Client confidential information:** strategy, unreleased products, performance data, meeting transcripts.
2. **AdConversion IP:** methodologies, frameworks, skills.
3. **The integrity of the knowledge.** Agents act on what they read, so a wrong or poisoned fact is a security issue, not just a quality issue.

Main threats, in rough order of likelihood:

| # | Threat | Example |
|---|---|---|
| T1 | Cross-client leakage | An agent working on Client A retrieves Client B's strategy. A person moves between accounts and keeps access. |
| T2 | Over-privileged agent credentials | A long-lived token with full access leaks through a log, a laptop or a misconfigured tool. |
| T3 | Unauthorized external transmission | Client data sent to an unapproved LLM, SaaS or vendor default (for example Baalda's managed server or auto-updater). |
| T4 | Knowledge poisoning | Ingestion or an agent writes an incorrect "fact" that other agents then trust. Includes prompt injection inside transcripts or documents. |
| T5 | Loss or silent deletion | Accidental deletion, or an overwrite without history. |
| T6 | Insider misuse / no accountability | Someone exports a client's knowledge base, and we can't tell who or when. |

---

## 2. Requirements

### 2.1 Data residency and egress (T3)

- **SEC-EGR-1 (MUST):** All storage runs on infrastructure AdConversion controls: databases, Git repositories, search indexes, backups and logs.
- **SEC-EGR-2 (MUST):** The production network denies outbound traffic by default. Only these destinations are allowed:
  - approved LLM endpoints
  - Grain's API
  - our identity provider
  - OS and package update mirrors
- **SEC-EGR-3 (MUST):** A machine-readable list of approved LLM providers is enforced in code.
  - Any call that sends client content must name a client and an approved provider.
  - The call is logged under SEC-AUD-1.
- **SEC-EGR-4 (MUST):** No telemetry, analytics, crash reporting, auto-update or "phone home" in any component we ship. Third-party components must have these disabled and verified.
- **SEC-EGR-5 (MUST):** Before launch, signed contracts must be in place:
  - LLM vendors used with client data are on business terms with no training on our data and zero or minimal retention
  - they are listed as subprocessors where client contracts require it
- **SEC-EGR-6 (SHOULD):** Each client record carries a data-handling flag (for example "no external LLM"), which the gateway enforces.

### 2.2 Identity and authentication (T2, T6)

- **SEC-AUTH-1 (MUST):** Staff sign in through company SSO (OIDC; Google Workspace assumed).
  - No self-service sign-up.
  - Removing someone from SSO removes their access.
- **SEC-AUTH-2 (MUST):** Two-factor authentication, enforced at the identity provider.
- **SEC-AUTH-3 (MUST):** Each agent or integration gets its own identity. Agents never share a human's credentials.
- **SEC-AUTH-4 (MUST):** Agent tokens have all of the following:
  - an explicit **scope**: a list of clients, plus "company" and/or "skills"
  - a **mode**: read, or read+propose
  - an **expiry**: 90 days maximum by default
  - a named **owner** (a human accountable for the agent)
- **SEC-AUTH-5 (MUST):** Token handling:
  - tokens are stored only as hashes
  - they are shown once
  - they can be revoked instantly
  - they are accepted **only in the `Authorization` header, never in URLs** (Baalda's server accepts them in the URL; we must not)
- **SEC-AUTH-7 (MUST):** Each agent token is issued per harness and records the vendor behind it (for example `codex-cli/openai`, `gemini-cli/google`, `claude-code/anthropic`). Combined with SEC-EGR-6, the gateway refuses to serve a client's content to a vendor that is not approved for that client. Staff connect only from company business accounts, never personal ones.
- **SEC-AUTH-6 (SHOULD):** Failed-authentication rate limiting on every endpoint, including token use.

### 2.3 Authorization and client isolation (T1)

- **SEC-ISO-1 (MUST):** Each client's knowledge lives in its own isolation unit: a separate repository and a separate index partition. Access is granted per unit.
- **SEC-ISO-2 (MUST):** Deny by default. New clients and new staff start with no access. Access is granted to a team (for example a pod) or a person, and is reviewed quarterly.
- **SEC-ISO-3 (MUST):** Every query filters by client before anything else.
  - Search results are filtered server-side by the caller's scope **before** ranking and before any text is returned.
  - Cross-client search is only possible for identities explicitly scoped to multiple clients.
- **SEC-ISO-4 (MUST):** Automated tests prove isolation. For every endpoint and MCP tool, a test confirms that a token scoped to Client A cannot read, search, list, or learn of the existence of Client B's content.
- **SEC-ISO-5 (SHOULD):** Shared, client-agnostic knowledge (methodology, skills) is kept separate from client repositories. Generalized learnings move from client to company knowledge only through an approved, anonymized proposal.

### 2.4 Integrity and change control (T4, T5)

- **SEC-INT-1 (MUST):** Agents and ingestion **cannot change canonical knowledge directly**. They create proposals that a human with the right permission approves.
- **SEC-INT-2 (MUST):** Every proposal records:
  - who or what proposed it
  - its sources (for example Grain meeting ID and timestamp, document ID)
  - the reviewer and the decision
- **SEC-INT-3 (MUST):** Ingested content is treated as **untrusted data**.
  - Instructions inside transcripts or documents are never executed.
  - Extraction prompts are hardened against injection.
  - The reviewer sees the source excerpt next to each proposed change.
- **SEC-INT-4 (MUST):** Complete, permanent history of every canonical change. Restoring any previous version is a routine operation.
- **SEC-INT-5 (MUST):** Writes use revision preconditions. A write based on a stale read is rejected, not silently merged.
- **SEC-INT-6 (SHOULD):** The default branch is protected. History cannot be rewritten or force-pushed.

### 2.5 Audit (T6)

- **SEC-AUD-1 (MUST):** An append-only audit log records:
  - every read, search, proposal, approval or rejection, and export
  - every permission change, token creation or revocation, and LLM call carrying client data
- **SEC-AUD-2 (MUST):** Each entry has: timestamp, actor (human or agent, plus the owning human), client scope, action, resource, result, and request ID. Entries hold **no** document content.
- **SEC-AUD-3 (MUST):** Audit logs are retained for at least 1 year and are readable only by admins.
- **SEC-AUD-4 (SHOULD):** Alerts fire on unusual access, such as one identity reading many clients or a bulk export.

### 2.6 Data protection

- **SEC-DATA-1 (MUST):** Encrypted traffic everywhere: TLS 1.2+ externally, and internal service traffic on a private network.
- **SEC-DATA-2 (MUST):** Encryption at rest for disks and backups.
- **SEC-DATA-3 (MUST):** Backups are encrypted, kept off the primary host but still on controlled infrastructure, and restore-tested every quarter. Recovery point objective is 24 hours or better.
- **SEC-DATA-4 (MUST):** Secrets (API keys, database passwords) live in a secrets manager or environment files outside Git. Never in repositories, logs or prompts.
- **SEC-DATA-5 (MUST):** Client offboarding: we can export a client's knowledge base and then delete it, including indexes, backups on a documented schedule, and the audit trail of the deletion.
- **SEC-DATA-6 (MUST, development):** Development and testing use **synthetic data only**. Real client data never enters dev environments, test fixtures, issue trackers or AI coding sessions.

### 2.7 Software supply chain

- **SEC-SUP-1 (MUST):** Dependencies are pinned with lockfiles. License scanning in CI blocks GPL or AGPL in our own distributed code, unless approved.
- **SEC-SUP-2 (MUST):** Automated dependency vulnerability scanning, and patches for critical issues within 7 days.
- **SEC-SUP-3 (SHOULD):** Container images are built from source in our CI and pinned by digest.
- **SEC-SUP-4 (MUST):** Updates are pulled by us. No component auto-installs updates in production.

### 2.8 Network exposure

- **SEC-NET-1 (MUST):** Admin interfaces (database, Git server admin) are not exposed to the internet.
- **SEC-NET-2 (SHOULD):** The whole platform is reached only through SSO-protected access or a VPN (for example Tailscale) until there is a reason to expose more.

---

## 3. What this means for the Baalda option specifically

If Option A (fork) were chosen, these Baalda behaviors would violate the requirements and must be changed before any real data touches it:

| Baalda behavior | Violates |
|---|---|
| Managed-server default `api.baalda.com` | SEC-EGR-1, SEC-EGR-4 |
| Auto-updater using the vendor's key | SEC-EGR-4, SEC-SUP-4 |
| Server release poll | SEC-EGR-4 |
| Open sign-up, no email verification, password-only login | SEC-AUTH-1 |
| MCP tokens without scope or expiry, and accepted in URLs | SEC-AUTH-4, SEC-AUTH-5 |
| Access-only audit log | SEC-AUD-1 |
| History capped at 50 versions per note | SEC-INT-4 |
| Direct, immediately canonical agent writes | SEC-INT-1 |
| Join codes that never expire; unauthenticated public links | SEC-ISO-2 |
| Local Claude/Codex "Assistant" using personal accounts | SEC-EGR-3 |
