# Milestone 0: Environment and toolchain

**Status:** Complete (2026-11-26)

## What was built

| Piece | File(s) | Why |
|---|---|---|
| pnpm workspace monorepo | `package.json`, `pnpm-workspace.yaml` | One install, one test command, one CI for the gateway, the ingestion worker and shared code. |
| Strict TypeScript | `tsconfig.base.json` | It catches whole classes of bugs, including ones AI-written code tends to introduce, before they run. |
| Biome (lint + format) | `biome.json` | One zero-plugin tool instead of ESLint plus Prettier (about 10 packages). Less to maintain. |
| Vitest | `vitest.config.ts` | Fast tests. 15 tests today, mostly proving the license gate works. |
| License gate | `scripts/license-policy.mjs`, `scripts/check-licenses.mjs` | Blocks copyleft and unknown licenses in production dependencies (SEC-SUP-1). Fails closed on unexpected output. |
| Vulnerability audit | `pnpm check:audit` | Fails CI on high or critical advisories (SEC-SUP-2). |
| CI | `.github/workflows/ci.yml` | Runs every gate on every push and pull request, with read-only permissions. |
| Dependabot | `.github/dependabot.yml` | Weekly dependency update pull requests, so patching is a review, not a project. |
| Environment check | `scripts/doctor.sh` (`pnpm env:check`) | Read-only readiness check for any developer machine. |
| Agent instructions | `AGENTS.md` (+ `CLAUDE.md`, `GEMINI.md` pointers) | One set of rules for every AI coding tool. That is the any-LLM principle applied to development too. |

## What you learned (founder notes)

- **Guardrails are code, not policy docs.** "No GPL dependencies" and "no
  vulnerable packages" are enforced by CI on every change, so nobody has to
  remember them, human or AI.
- **Fail closed.** The license checker initially crashed on an unexpected pnpm
  message. The fix accepts exactly that one known message and still fails on
  anything else. A security check that passes when confused is worse than none.
- **Tools have sharp edges.** `pnpm ci`, `pnpm doctor` and `pnpm licenses` are
  built-in pnpm commands that silently shadowed our scripts. We namespaced ours
  (`check`, `check:*`, `env:check`).
- **AGENTS.md is the cross-vendor standard.** Codex reads it natively.
  `CLAUDE.md` and `GEMINI.md` just import it, so the rules live in one place.

## Open item

- The Docker engine is not running in the cloud dev container. Milestone 1
  (local Forgejo + Postgres) needs it on whichever machine runs the stack. Run
  `pnpm env:check` on your laptop to confirm.
