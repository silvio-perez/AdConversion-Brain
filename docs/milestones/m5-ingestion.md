# Milestone 5: Grain ingestion (synthetic, local model)

**Status:** Pipeline complete (2026-11-26). Real model (Bedrock) and real Grain
connection are pending AWS access and the Milestone 6 security gate, as agreed.

## What was built

| Piece | Where |
|---|---|
| Meeting source interface + synthetic fixtures (5 meetings, every edge case) | `apps/ingest/src/grain.ts`, `fixtures/synthetic-grain/` |
| Exactly-one-client mapping by email domain | `mapping.ts`, `config/client-mapping.json` |
| Model boundary, prompt with fenced transcript, local stand-in model | `model.ts` |
| Quote verification + prompt-injection filter | `verify.ts` |
| Learnings document renderer (passes the knowledge conventions) | `render.ts` |
| Pipeline with idempotency (local state + Brain's proposal list) | `pipeline.ts`, `state.ts` |
| `pnpm ingest` CLI | `cli.ts` |
| `brain-ingest` service account (can propose to client repos, can't approve) | seed script |
| Operator guide | `docs/ingestion.md` |

Gateway improvement found along the way: proposal titles for new documents now
lead with the document's title instead of its file path.

## What the tests prove

**Unit (19 tests):**

- Internal, unknown and ambiguous meetings are skipped and **never sent to the model**.
- Globex content only ever reaches Globex.
- A second run, even with local state wiped, re-sends nothing and duplicates nothing.
- With a vendor not approved for Globex, Globex's transcript never reaches the model.
- Vendor mismatch and read-only tokens are refused.
- An honest extractor ignores injected instructions; a model that obeys them is caught.
- A model that invents quotes produces no proposal.
- Malformed output is rejected and retried.

**Live (3 tests on real Forgejo):** ingestion opens proposals as the bot in the
right repositories only, a rerun opens nothing new, Bob can't see Acme's
proposals, and an ingestion token for an unapproved vendor is refused.

**Mutation-tested (edits verified to have applied):**

| Safeguard removed | Tests that failed |
|---|---|
| Vendor check before the model call | 1 |
| Quote verification | 1 |
| Injection filter | 1 |
| Ambiguous-meeting guard | 4 |

Totals: 111 unit tests and 23 live-stack tests.

## Decisions made during this milestone

1. **Ingestion is just another agent.** No new write path, no new privileges.
2. **One proposal per meeting**, as a new learnings document. It doesn't edit
   existing documents in v1. Editing `strategy.md` from a call is higher risk;
   the proposal instead links to related documents for the reviewer to update.
3. **Vendor `local`** was added to the vendor policy for models that run on our
   own infrastructure. The stand-in honestly identifies as `local`, not Anthropic.
4. **Closed proposals can be re-proposed.** Merged or open ones never are.

## What you learned (founder notes)

- **Deterministic code decides; the model only describes.** Which client, which
  file, which status: all decided by code before or after the model. The
  model's output can't move data between clients.
- **Verify the model, don't trust it.** A wrong quote means a dropped learning.
  That turns "the AI might hallucinate" into a checkable property.
- **Defence in layers, with an honest backstop.** Mapping, vendor check, schema,
  quote check, injection filter, draft status, human review. No single layer is
  perfect; together they are robust.
- **State you can lose shouldn't be the only guard.** Deduplication also asks
  the Brain, so a lost state file can't cause duplicate proposals or re-sent transcripts.
