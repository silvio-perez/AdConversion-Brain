# AGENTS.md

Instructions for any AI coding agent working in this repository (Claude Code,
OpenAI Codex, Gemini CLI, Cursor, and others). Vendor-neutral on purpose.

## What this project is

AdConversion Brain: a private, Git-backed markdown knowledge platform exposed to
employees and AI agents over MCP and REST. Read `docs/architecture-decision.md`
before making structural changes.

## Non-negotiable rules

1. **Synthetic data only.** Never add real client names, transcripts, emails or
   other client information to code, tests, fixtures, docs or prompts
   (SEC-DATA-6). Use the synthetic clients "Acme Analytics" and "Globex Cloud".
2. **No new outbound network calls** to third-party services without an entry in
   the approved-vendor list and founder approval (SEC-EGR-2, SEC-EGR-3).
3. **No telemetry, analytics or auto-update** in anything we ship (SEC-EGR-4).
4. **Agents propose, humans approve.** Never add a code path that lets an agent
   write directly to canonical knowledge (SEC-INT-1).
5. **Client isolation is tested.** Any new endpoint or MCP tool needs a test
   proving a token scoped to one client cannot see another (SEC-ISO-4).
6. Ask before adding production dependencies; the license gate must stay green.

## Workflow

- `pnpm env:check`: verify the machine is ready.
- `pnpm check`: lint, typecheck, tests, license policy. Must pass before commit.
- `pnpm format`: auto-fix formatting.
- Small commits with clear messages. Update docs alongside code.
