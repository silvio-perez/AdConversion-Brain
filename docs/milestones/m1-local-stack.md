# Milestone 1: Local stack and knowledge structure

**Status:** Complete (2026-11-26)

## What was built

| Piece | Where | Why |
|---|---|---|
| Local stack | `deploy/local/docker-compose.yml` | Forgejo + Postgres, bound to localhost only. Starts in about 7 seconds. |
| Locked-down Forgejo | same file, commented | No sign-up, sign-in required to view anything, all repos private, update checker / Gravatar / federation / CDN off. |
| Secret generation | `pnpm stack:init` | Random local secrets in a gitignored, owner-only `.env`. No default passwords exist anywhere. |
| Knowledge conventions | `docs/knowledge-conventions.md` | Repo per client, folder layout, required frontmatter, skills format, PR-only changes. |
| Frontmatter validator | `tools/knowledge` | Enforces the conventions in CI, including "a document's `client` must match the repo it's in" and "fixtures must be marked synthetic". |
| Synthetic data | `fixtures/synthetic/` | Two fictional clients, company knowledge, one skill. Globex contains a canary string to detect leaks. |
| Seed script | `pnpm stack:seed` | Creates the org, repos, teams, users and branch protection. Idempotent. |
| Isolation tests | `pnpm test:stack` | 9 live tests, now also run in CI on every push. |

## Access model as seeded

| Team | Permission | Repositories | Members |
|---|---|---|---|
| all-staff | read | company, skills | alice, bob |
| pod-acme | write (via PR) | client-acme-analytics | alice |
| pod-globex | write (via PR) | client-globex-cloud | bob |

`main` is protected on every repository: no direct pushes (including admins),
one approval required, stale approvals dismissed on new commits.

## What the tests prove

- Anonymous users see nothing.
- Alice (Acme pod) reads company knowledge and Acme, and gets **404, not 403**
  for Globex. A 403 would confirm that Globex exists, so 404 hides it.
- Globex never appears in Alice's listings, search results or Git access.
- Isolation is symmetric (Bob cannot see Acme).
- Nobody can write to `main` directly. Alice can propose a change as a pull
  request but cannot merge it without approval.
- Read-only staff cannot propose changes to company knowledge.

**The tests were themselves tested:** temporarily adding Alice to the Globex
team made 3 of 9 fail; reverting restored 9 of 9.

## What you learned (founder notes)

- **Use boring infrastructure for the hard parts.** Permissions, history, review
  and approval came from configuring Forgejo, not writing code. Our code so far
  is the glue: a seed script, a validator and tests.
- **404 vs 403 is a security decision.** "Forbidden" leaks that something exists.
  For client confidentiality, "not found" is correct.
- **Test your tests.** A test that has never been seen failing might not be
  testing anything. We broke isolation on purpose to watch it fail.
- **The governed model has a cost.** Even a typo fix is now a pull request. That
  is the trade we chose. If it slows the team down, the lever is lighter review
  rules for low-risk folders, not abandoning review.

## Network note

The cloud development environment needed `codeberg.org` and `data.forgejo.org`
allowed to download the Forgejo image. That was approved and saved as the
personal `adconversion-brain` cloud environment.
