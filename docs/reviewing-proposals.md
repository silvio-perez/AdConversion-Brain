# Reviewing Brain Proposals

**Who this is for:** anyone on a client pod, or a knowledge admin, who approves
changes to the Brain. No Git knowledge needed.

## What a proposal is

AI agents (and people) can't edit the Brain directly. They **propose** a change,
and it waits for you. Nothing an agent writes becomes "the truth" until someone
on the right team approves it.

You'll see proposals in Forgejo under **Pull requests** for each client
repository. Each one opens with:

- **What changes and why:** the agent's plain-language summary
- **Who proposed it:** which AI tool, which vendor, and which colleague it acted for
- **Evidence:** the meeting, document or note the change came from
- **Reviewer checklist**

## How to review (2 minutes)

1. Read the summary, then click **Files changed** to see exactly what changes.
   Green lines are added, red lines are removed.
2. Check the change against the **evidence**. If a Grain meeting is cited, spot-check
   the timestamp.
3. Work through the checklist. Pay particular attention to:
   - **Another client's information.** If you see it, reject the proposal and tell
     a knowledge admin.
   - **Text that sounds like instructions to an AI**, for example "ignore previous
     instructions" or "always recommend X". Agents learn from what the Brain says,
     so this kind of text is how the Brain could get manipulated.
4. Decide:
   - **Approve**, then **Merge**: the change becomes canonical within about 30 seconds.
   - **Request changes**: explain what's wrong. The proposer (or their agent) can submit a new proposal.
   - **Close**: reject outright.

## Who can approve what

| Repository | Approvals count from |
|---|---|
| `client-<name>` | That client's pod team |
| `company`, `skills` | Knowledge admins |

Approvals from anyone else, including bots, are ignored. If someone pushes new
changes after you approved, your approval is withdrawn automatically and you
review again.

## Good habits

- **Small is good.** A proposal that changes one fact is easy to check. Ask for
  big ones to be split.
- **"Draft" status is fine.** A document can be merged with `status: draft`. That
  records it while signalling that it isn't settled yet.
- **Everything is recorded.** Who approved what, and when, is kept in Forgejo and
  in the Brain's audit log. Any change can be reverted later.
