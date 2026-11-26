# Milestone 4: Skills library

**Status:** Complete (2026-11-26)

## What was built

| Piece | Where | Purpose |
|---|---|---|
| Draft → publish model | `skills` repo + release tags | Drafts live on `main` (reviewed like any knowledge). A tag `<name>/v<N>` publishes an immutable version. |
| Tag protection | seed script | Only `knowledge-admins` can publish. Staff and bots are refused by Forgejo. |
| `skills.yaml` | `skills` repo | Required / optional / deprecated, changed via reviewed proposals. |
| Catalog sync | `apps/gateway/src/skills.ts` | The gateway serves only the latest published version of each skill (text files, 200 KB each). |
| MCP + REST | `list_skills`, `get_skill`, `read_skill_file`; `/v1/skills/...` | Any MCP tool can load a skill on demand. No install needed. |
| `pnpm skills` | `tools/skills-sync` | Installs published skills into `~/.claude/skills` and `~/.agents/skills` (or `--target`). |
| Publishing guide | `docs/publishing-skills.md` | For knowledge admins and staff. |

## Safety properties, each tested

| Property | Test |
|---|---|
| Only knowledge admins can publish (staff and the bot are refused) | live "only knowledge admins can publish" |
| Drafts are never served | "drafts are never served" |
| Skills need the `skills` source; otherwise the standard 404 | unit + live |
| Skill file paths can't escape the skill | REST path-trick test; sync `safeRelativePath` |
| Sync never overwrites or deletes folders it didn't create | "never overwrites or deletes..." |
| Sync refuses files whose hash doesn't match | "refuses files that could escape... or were corrupted" |
| Installs are atomic (temp folder, then swap) | covered by upgrade test |
| Every skill access is audited with the exact version | "skill access is audited" |

**Mutation-tested:** disabling the "not installed by the Brain" guard failed 1
test; disabling path and hash checks failed 1; removing the skills-scope check
failed 1. (The first attempt at the second mutation silently didn't apply. A
mutation only counts once you've confirmed the code actually changed.)

Totals: 54 gateway + sync unit tests (92 overall) and 20 live-stack tests.

## Decisions made during this milestone

1. **Git tags as versions, not a database.** Immutable, auditable, and visible in
   Forgejo, with no custom publish UI to build.
2. **Text files only in skills.** Binary files are skipped with a warning. Covers
   instructions, templates and scripts; images can come later if needed.
3. **Sync runs from the repository for now** (`pnpm skills`). Staff won't clone the
   repo long-term. Packaging it as a single download is Phase 2.
4. **Gemini CLI folder not set by default.** Claude Code and the cross-vendor
   `~/.agents/skills` are defaults; other tools use `--target` until we confirm
   their folder on a real install.

## What you learned (founder notes)

- **Immutability is a governance feature.** "Everyone on v3" means the same
  bytes for everyone, so a bad result can be traced to an exact skill version
  through the audit log.
- **Never be clever with other people's files.** The sync only manages folders
  it created and marks. A hand-built skill with the same name is left alone.
- **Two delivery routes, one source.** On-demand over MCP works in any tool
  immediately. Local install is faster and works offline. Both serve the same
  published version.
