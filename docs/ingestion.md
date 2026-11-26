# Grain Ingestion

Turns client meeting recordings into **proposed** knowledge updates. Nothing
from a call becomes Brain knowledge until someone on that client's pod approves it.

## How it works

```
Grain meeting
  -> map to exactly one client (by participant email domain)   skip if internal / unknown / ambiguous
  -> check the client is in the token's scope                  skip if the vendor isn't approved for that client
  -> send transcript + client context to the model             the only point where data leaves
  -> validate output, verify every quote, filter injections    drop anything unverifiable
  -> one proposal per meeting: learnings/<date>-meeting-<id>.md
  -> pod member reviews in Forgejo (docs/reviewing-proposals.md)
```

The worker is an ordinary agent: it holds a propose-mode token and uses the same
gateway as Claude or Codex. It inherits client scope, vendor policy, document
validation, rate limits and audit logging, and it has no special write access.

## Configuration

| File | Purpose |
|---|---|
| `config/client-mapping.json` | Which email domains belong to which client, the accountable `owner` per client, and our internal domains |
| `config/vendor-policy.json` | Which AI vendors may receive each client's data |

A meeting is processed only if its external participants match **exactly one**
client. Adding a client means adding its domains here (a reviewed change).

## Running

```bash
# One-off token for the ingestion service (an admin runs this)
pnpm brain token create --owner brain-ingest --harness custom --vendor local \
  --mode propose --sources client-acme-analytics,client-globex-cloud --days 30

INGEST_TOKEN=brn_... pnpm ingest --since 2026-11-01 --dry-run   # preview
INGEST_TOKEN=brn_... pnpm ingest --since 2026-11-01             # open proposals

# With Claude on Bedrock (on the AWS server; credentials from its IAM role)
INGEST_BEDROCK_MODEL=<model or inference profile id> AWS_REGION=us-east-1 \
  INGEST_TOKEN=brn_... pnpm ingest --model bedrock --since 2026-11-01
pnpm ingest:eval --model bedrock   # score the model before trusting it
```

The ingestion token's vendor must match the model: `local` for the stand-in,
`anthropic` for Bedrock.

Runs are idempotent. A meeting that already has a proposal (open or merged) is
never re-sent to the model, even if the worker's local state is lost. If a
reviewer **closes** a proposal, the next run may propose that meeting again.

## Safeguards and what they protect against

| Safeguard | Protects against |
|---|---|
| Exactly-one-client mapping | Filing one client's call into another client's knowledge |
| Scope + vendor check before the model call | Sending a client's transcript to a vendor they haven't approved |
| Model vendor must equal token vendor | Misconfiguration that would bypass the vendor check |
| Output schema validation | Malformed or oversized model output |
| Every quote verified against the transcript | Hallucinated or fabricated evidence |
| Prompt-injection phrase filter | A transcript that tries to instruct the AI |
| The model never chooses the client or file path | Injected "write this into another client" |
| `status: draft`, human approval required | Anything the checks above miss |
| Logs contain meeting ids and outcomes only | Transcript text leaking into logs |

**Honest limits.** The injection filter catches common phrasings, not every
possible attack. Human review is the real backstop, and the reviewer checklist
asks about it explicitly.

## Status

| Piece | Status |
|---|---|
| Pipeline, safeguards, tests | Done, tested with synthetic meetings |
| Model | **Local stand-in only** (`local-rule-model`: rule-based, sends nothing anywhere). Its titles are crude copies of sentences; a real model writes proper summaries. |
| Claude via AWS Bedrock | **Adapter built and unit-tested** (`apps/ingest/src/bedrock.ts`, stubbed AWS calls). Refuses non-Anthropic model ids so the vendor policy stays honest. Credentials come from the server's IAM role. Not yet run against real Bedrock (needs the AWS account). |
| Grain API | **Not built.** Needs a Grain API key and approval (Milestone 6). Implement `MeetingSource` in `apps/ingest/src/grain.ts`. |
| Scheduled runs | Run manually for now; a schedule is part of Milestone 6 deployment. |
| Evaluation set | **Built** (`pnpm ingest:eval [--model local|bedrock]`): recall of key facts + zero forbidden content, pass/fail threshold. Only 3 meetings so far and tuned to the stand-in; grow it to 20+ synthetic meetings before judging Claude. |
