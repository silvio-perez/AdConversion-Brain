# Milestone 3: Proposals and approval

**Status:** Complete (2026-11-26)

## What was built

| Piece | Where | Purpose |
|---|---|---|
| `propose_change`, `propose_document` | MCP + `POST /v1/sources/{source}/proposals` | Agents suggest changes; each becomes a branch and pull request. |
| `list_proposals` | MCP + `GET /v1/proposals` | Agents can see what is pending, merged or rejected, and avoid duplicates. |
| Propose-mode tokens | `pnpm brain token create --mode propose` | Separate from read tokens. The owner must have write access in Forgejo. |
| `brain-proposer` bot | seed script | Opens branches and PRs. Cannot write to `main`, cannot merge, and its approvals don't count. |
| Approver lists | branch protection | Only the client's pod (or knowledge admins for company/skills) can approve. |
| Revision checks | `brain.ts`, `proposals.ts` | An update must name the revision it was based on. Checked live against Git, then again by Forgejo itself. |
| Validation | `@brain/knowledge` | Proposals must follow the knowledge conventions, including "client field matches the repository". |
| Decision tracking | `Brain.reconcile()` | Approvals, merges and rejections made in Forgejo are copied into our audit log. |
| Schema migrations | `store.ts` | Versioned upgrades. The real development database moved from v1 to v2 with data intact. |
| Reviewer guide | `docs/reviewing-proposals.md` | Plain-language guide for pod members. |

## What the tests prove

**Unit (40 gateway tests, fake Forgejo):**

- Read tokens don't see propose tools, and are refused over REST.
- A proposal opens a PR with evidence, tool, vendor and owner.
- The canonical document doesn't change until merge.
- Stale revisions are refused.
- Creating over an existing document is refused.
- Unsafe paths are rejected (`../`, hidden folders, non-markdown, upper case).
- A document that claims the wrong client is rejected.
- Proposing into another client returns the standard 404.
- `list_proposals` never shows other clients.
- The vendor policy applies to proposals.
- There's a 20-proposals-per-hour cap per token.
- Approvals and merges are recorded once, and recording is idempotent.

**Live (17 tests, real Forgejo):**

- Alice can't get a propose token for `company`.
- The full loop: a Gemini CLI token proposes, the PR is opened by the bot, the
  bot fails to merge or push to main, Alice approves and merges, and the Brain
  serves the new document with the approval and merge attributed to her.
- An outdated revision is refused.
- A bot approval on a human PR does not unblock the merge.

**Mutation-tested:** letting read-only tokens propose failed 2 tests; removing
the client check on proposals failed 3.

## Decisions made during this milestone

1. **No webhook (deviation from the roadmap).** The existing 30-second poll also
   records decisions, which avoids an inbound network path from Forgejo, a
   shared secret, and Docker host networking. Revisit if 30 seconds feels slow.
2. **The token's owner may approve their own agent's proposal.** The bot is the
   PR author, so Forgejo sees the owner as a separate reviewer. For a small team
   that is pragmatic. **Decision for you:** if you want four-eyes review (the
   requester can't approve), that needs a custom check and is about a day of work.
3. **Agents send whole documents, not targeted edits.** That is simpler and the
   reviewer sees a normal diff. Targeted edits (Baalda-style anchors) can come later.
4. **Proposals can be merged with `status: draft`.** Merging records a fact;
   `status` says how settled it is.

## What you learned (founder notes)

- **Least privilege per job.** Three credentials, three jobs: read everything
  (gateway), propose (bot, never merge), approve (humans on the right team). A
  compromise of one doesn't grant the others.
- **Check twice, at different layers.** Revisions are checked by us and then by
  Forgejo. Mutation testing showed that removing our check still left Forgejo's
  in place. That is defence in depth working as designed.
- **Close the side doors.** The bot couldn't merge its own PRs, but it *could*
  have approved a human's. Approver lists close that.
- **The simplest thing that meets the requirement.** Polling replaced a webhook
  and removed three moving parts.
