# Publishing Skills

**Who this is for:** knowledge admins. Skills are reusable AI workflows (a
folder with a `SKILL.md`) that every AI tool connected to the Brain can use.

## Lifecycle

| Stage | Where | Who |
|---|---|---|
| **Draft** | `main` branch of the `skills` repository, changed via reviewed proposals like any knowledge | Knowledge admins approve |
| **Published** | A release tag `<skill-name>/v<N>` | Knowledge admins only (enforced by Forgejo) |
| **Distributed** | MCP (`list_skills`, `get_skill`) and `pnpm skills` sync | Automatic within about 30 seconds |

Drafts are never served. Agents and staff only ever get published versions, and
a published version never changes. Fixing a skill means publishing the next version.

## Publish a new version

1. Make sure the change is merged to `main` (approved proposal).
2. In Forgejo, open the `skills` repository, go to **Tags** (or **Releases**), and choose **New tag**.
3. Name it `<skill-name>/v<next number>`, for example `linkedin-ad-copy/v3`. Target: `main`.
4. Optional: write release notes saying what changed.

Within about 30 seconds the new version is live. People get it the next time
they run `pnpm skills`, and agents get it immediately through `get_skill`.

## Required, optional, deprecated

`skills.yaml` at the root of the `skills` repository:

```yaml
skills:
  linkedin-ad-copy:
    status: required    # installed for everyone
  meeting-recap:
    status: optional    # installed for people who opt in
```

`deprecated` stops a skill being served and removes it from people's machines
at their next sync. Changing `skills.yaml` is itself a reviewed proposal.

## For everyone: installing skills

```bash
export BRAIN_TOKEN=brn_...        # a token that includes the "skills" source
pnpm skills                        # install/update required skills
pnpm skills --add meeting-recap    # opt into an optional skill (remembered)
pnpm skills --remove meeting-recap # opt out
pnpm skills --dry-run              # show what would change
```

By default skills go to `~/.claude/skills` (Claude Code) and `~/.agents/skills`
(the cross-vendor location used by Codex and others). Add `--target <folder>`
for other tools. Sync never touches skill folders it didn't create.
