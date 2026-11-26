# Knowledge Conventions

How knowledge is organised in AdConversion Brain. Humans and agents both follow
these rules, and CI enforces the frontmatter part (`pnpm check:knowledge`).

## 1. Repositories

All repositories live in the Forgejo organisation `adconversion`.

| Repository | Contains | Who can read | Who can change (via approved PR) |
|---|---|---|---|
| `company` | Methodologies, frameworks, SOPs | All staff | Knowledge admins |
| `skills` | Reusable AI skills (`<name>/SKILL.md`) | All staff | Knowledge admins |
| `client-<slug>` | One client's knowledge base | That client's pod only | That client's pod |

**Why one repository per client:** a repository is the unit Forgejo, Git and
our gateway all understand natively. Access is all-or-nothing per client, which
makes isolation simple to reason about and to test (SEC-ISO-1).

## 2. Client repository layout

```
client-<slug>/
  README.md                index of the client's knowledge
  business-context.md      company, ICP, pricing, competitors
  product-marketing/       positioning, messaging, personas
  brand-guidelines.md      voice, vocabulary, visual identity
  design-system/           design tokens, components, examples
  strategy.md              current channel and campaign strategy
  learnings/               dated experiment results and decisions
```

Files are created as needed; empty folders are not required.

## 3. Frontmatter (required on every document except `SKILL.md`)

```yaml
---
title: Acme Analytics brand guidelines
type: brand-guidelines      # see list below
client: acme-analytics      # client slug, or null for company/skills
owner: alice.synthetic      # accountable human (Forgejo username)
status: approved            # draft | approved | deprecated
last_reviewed: 2026-11-20   # YYYY-MM-DD
sources:                    # where this knowledge came from
  - kind: grain             # grain | document | manual
    ref: meeting-id
    at: "00:12:30"          # optional: timestamp or page
---
```

`type` is one of: `index`, `business-context`, `product-marketing`,
`brand-guidelines`, `design-system`, `strategy`, `learning`, `methodology`, `sop`.

Rules:

- `client` must match the repository (`client-acme-analytics` -> `acme-analytics`;
  `company` and `skills` -> `null`). This prevents a document being filed in
  the wrong client's knowledge base.
- `sources` are how reviewers check a proposal against its evidence (SEC-INT-2).
- Fixtures must also set `synthetic: true`.

## 4. Skills

A skill is a folder in the `skills` repository with a `SKILL.md` whose
frontmatter has `name` (matching the folder) and `description`. This is the
format Claude, Codex and the open agents convention all read.

Other files inside a skill folder (templates, examples, scripts) are resources
and need no frontmatter. `skills.yaml` at the repository root says which
published skills are `required`, `optional` or `deprecated`.

**Publishing:** a skill on `main` is a draft. A knowledge admin publishes it by
creating a release tag named `<skill-name>/v<N>` (for example
`linkedin-ad-copy/v2`). Only published versions are served to agents, and a
tag never changes, so everyone running v2 runs exactly the same skill.

## 5. Changing knowledge

The `main` branch of every repository is protected. Nobody, including admins and
bots, pushes directly. Every change is a pull request that needs one approval
from the right human team (SEC-INT-1, SEC-INT-6):

| Repository | Approvals count from |
|---|---|
| `client-<slug>` | that client's pod team |
| `company`, `skills` | `knowledge-admins` |

New commits withdraw earlier approvals. In the Forgejo web editor, choose "Create
a new branch for this commit and start a pull request". AI agents propose
through the gateway (`propose_change`, `propose_document`); see
`docs/reviewing-proposals.md`.
