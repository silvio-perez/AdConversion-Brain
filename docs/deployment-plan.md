# Milestone 6: Deployment, Security Gate and Pilot

**Status:** Phase A complete (2026-11-26). Phase B (creating AWS resources) needs explicit approval at step B3.
**Date:** 2026-11-26
**Depends on:** AdConversion AWS account (verification in progress), decisions in §8.

---

## 1. Goal

Run the Brain on AdConversion-controlled AWS infrastructure, prove every MUST in
`security-requirements.md`, and pilot it with company knowledge plus **one** real
client for 2–4 weeks.

This is the milestone where real data first enters. The gate in §5 must be fully
green **before** any real client document or transcript is loaded.

---

## 2. Target architecture

```
 Staff laptops & AI tools (Claude Code, Codex, Gemini CLI)
        |  Tailscale (encrypted private network; no public ports)
        v
 +---------------------------- AWS account: adconversion-brain ----------------------------+
 |  VPC, one subnet with NO inbound rules (no NAT gateway needed)                          |
 |                                                                                         |
 |  EC2 instance (4 GB RAM, encrypted disk)  -- IAM role, no access keys                   |
 |   Docker Compose:                                                                       |
 |    - Forgejo (Git, web UI, Google sign-in)      - Postgres (Forgejo data)               |
 |    - Brain Gateway (MCP + REST, SQLite)         - Ingestion (hourly timer)              |
 |    - Egress proxy (allowlist): only Grain API, Google sign-in, OS/package mirrors       |
 |                                                                                         |
 |  VPC endpoints (traffic never crosses the public internet):                             |
 |    - Bedrock runtime  -> Claude                                                         |
 |    - S3               -> encrypted, versioned backup bucket                             |
 |    - SSM              -> admin shell access without SSH                                 |
 |                                                                                         |
 |  CloudTrail -> S3 (who did what in AWS)   AWS Backup -> nightly disk snapshots          |
 +-----------------------------------------------------------------------------------------+
```

### Why each choice

| Choice | Why | Alternative considered |
|---|---|---|
| **One EC2 instance + Docker Compose** | Same stack we've tested in CI on every push. Cheapest, simplest to reason about. | Kubernetes or ECS: more moving parts than a 30-person team needs. |
| **No public ports. Staff connect over Tailscale** | Nothing to attack from the internet. Admin access via AWS SSM, so no SSH port either. | Public HTTPS with Google sign-in: needed later for claude.ai/ChatGPT web connectors (Phase 2). AWS Client VPN: similar security, much higher cost. |
| **IAM role on the instance** | No AWS keys exist anywhere to leak. Permissions limited to calling one Claude model and writing to one backup bucket. | Access keys: rejected (SEC-DATA-4). |
| **Bedrock over a VPC endpoint** | Transcripts go from our server to Bedrock inside AWS's network, never over the public internet. | Public Bedrock endpoint: works, but less contained. |
| **Egress allowlist proxy** | Containers that hold client data can only reach approved hosts (SEC-EGR-2). | AWS Network Firewall: same result at roughly $300+/month; overkill now. |
| **Google Workspace sign-in for Forgejo** | Offboarding = remove from Google. 2FA enforced by Google (SEC-AUTH-1/2). | Local passwords: only for one sealed break-glass admin. |

---

## 3. Work breakdown

Each step lists who does it and whether it needs your approval first. Time is
elapsed time with me doing the engineering.

### Phase A: build everything that doesn't need AWS (about 2 days, can start now)

| # | Step | Approval needed |
|---|---|---|
| A1 | Gateway and ingestion Docker images, built in CI, pinned by digest (SEC-SUP-3) | No |
| A2 | Production Compose file: internal network, egress proxy with allowlist, health checks, resource limits | No |
| A3 | Forgejo production config: Google OIDC sign-in, local sign-in off, admin break-glass | No |
| A4 | Backup script: Forgejo dump + Postgres + `VACUUM INTO` copies of gateway/ingest SQLite, encrypted upload to S3 | No |
| A5 | Restore script, and a CI job that restores a backup into a fresh stack and runs the isolation tests against it | No |
| A6 | Nightly token-owner re-check: revoke agent tokens whose owner lost access in Forgejo (closes the gap noted in Milestone 2) | No |
| A7 | Bedrock model adapter for ingestion (`model.ts`) + prompt evaluation set on synthetic transcripts | **Yes: dependency `@aws-sdk/client-bedrock-runtime`** |
| A8 | Infrastructure as code (Terraform or AWS CloudFormation) for §2, so the environment is reproducible and reviewable | **Yes: choice of tool** (recommend Terraform) |

### Phase B: stand up AWS (about 1 day, after the account is verified)

| # | Step | Who | Approval needed |
|---|---|---|---|
| B1 | Account hardening: root MFA, IAM Identity Center logins, budget alarm, CloudTrail on | You (guided) | n/a |
| B2 | Enable Claude in Bedrock in the chosen region | You (guided) | n/a |
| B3 | Apply the infrastructure code (VPC, endpoints, instance, role, bucket, backups) | Me, you watching | **Yes: deploy** |
| B4 | Install Tailscale on the instance; connect pilot users' laptops | Me + pilot users | **Yes: Tailscale as a vendor** |
| B5 | Set up Google OIDC app in Google Workspace admin; connect Forgejo | You (guided), me | n/a |
| B6 | Deploy the stack, seed **synthetic** data, run the full live test suite in production | Me | Included in B3 |

### Phase C: security gate (about 1 day)

| # | Step |
|---|---|
| C1 | Walk every MUST in `security-requirements.md` (§5 below) and attach evidence: test output, config, screenshots |
| C2 | Restore drill: restore last night's backup to a scratch instance, run the isolation tests against it |
| C3 | Isolation drill in production: tokens for client A cannot see client B (same suite as CI) |
| C4 | Egress drill: from inside each container, confirm non-allowlisted hosts are unreachable |
| C5 | Offboarding drill: remove a test user from Google, confirm Forgejo and gateway access stop |
| C6 | Write the gate report; **you sign off** before real data |

### Phase D: pilot (2–4 weeks)

| # | Step |
|---|---|
| D1 | Load real company knowledge (methodology, SOPs) via reviewed proposals |
| D2 | Create the pilot client's repository; pod adds its knowledge |
| D3 | Connect the Grain API (**approval: Grain API key and vendor entry**), ingestion for the pilot client only |
| D4 | Pilot users connect Claude Code / Codex / Gemini; run the real-harness conformance check that we couldn't do in the cloud workspace |
| D5 | Weekly 15-minute check-in on the metrics below; fix friction as it shows up |

---

## 4. Ongoing operations (what "low maintenance" means here)

| Task | Frequency | Effort |
|---|---|---|
| Backups (automatic) + check the backup alert | Daily, automatic | 0 |
| Review Dependabot PRs, rebuild images | Weekly | 15 min |
| Apply app updates (Forgejo, Node, images) in a maintenance window | Monthly | 30 min |
| OS security patches | Automatic (see decision 4) | 0 |
| Restore drill | Quarterly | 1 hour |
| Access review: who is on which pod team | Quarterly | 30 min |

---

## 5. Security gate checklist

Status today, and what Milestone 6 adds. **All MUSTs must show "Done" with
evidence before real data is loaded.**

| Requirement | Today | M6 adds |
|---|---|---|
| SEC-EGR-1 data on our infrastructure | Design | AWS account, encrypted disk, S3 |
| SEC-EGR-2 default-deny egress | Not done | Allowlist proxy + VPC endpoints + drill C4 |
| SEC-EGR-3 approved LLM list enforced | **Done** (vendor policy, tested) | Bedrock as `anthropic` vendor |
| SEC-EGR-4 no telemetry / phone-home | **Done** (Forgejo locked down, our code has none) | Re-verify in production (C4) |
| SEC-EGR-5 vendor contracts | Not done | **You:** AWS/Bedrock terms, client MSA check for the pilot client |
| SEC-AUTH-1 company SSO, no self-sign-up | Partial (no self-sign-up) | Google OIDC |
| SEC-AUTH-2 2FA | Not done | Enforced in Google Workspace |
| SEC-AUTH-3/4/5 scoped, expiring, header-only agent tokens | **Done**, tested | |
| SEC-AUTH-7 token per harness + vendor | **Done**, tested | |
| SEC-ISO-1/2/3/4 client isolation | **Done**, tested in CI | Drill C3 in production |
| SEC-INT-1/2/4/5 propose-only, evidence, history, revisions | **Done**, tested | |
| SEC-INT-3 untrusted ingested content | **Done** (quote verification, injection filter, human review) | Prompt evaluation set (A7) |
| SEC-AUD-1/2 audit log | **Done** (append-only, no content) | |
| SEC-AUD-3 1-year retention, admin-only | Not done | Nightly audit export to S3 with retention |
| SEC-DATA-1 TLS everywhere | Not done | Tailscale (WireGuard) + HTTPS |
| SEC-DATA-2 encryption at rest | Not done | Encrypted EBS + S3 encryption |
| SEC-DATA-3 backups + restore test | Not done | A4, A5, C2 |
| SEC-DATA-4 secrets outside Git | **Done** locally | AWS Secrets Manager or SSM Parameter Store |
| SEC-DATA-5 client offboarding | Not done | Documented export + delete procedure, tested on a synthetic client |
| SEC-DATA-6 synthetic data in dev | **Done** (rule + CI check) | |
| SEC-SUP-1/2 licenses + vulnerabilities | **Done** (CI) | |
| SEC-SUP-4 no auto-updates of app components | **Done** (pinned) | See decision 4 for OS patches |
| SEC-NET-1 admin interfaces not public | Not done | No public ports at all |

---

## 6. Pilot success criteria

Measured weekly from the audit log and Forgejo (no extra tracking tools):

| Metric | Target by end of pilot |
|---|---|
| Pilot users querying the Brain through an AI tool | At least 4 of 5 users, weekly |
| Proposals reviewed within 2 working days | 90% |
| Ingestion learnings approved (vs closed) | 50% or more; if lower, the extraction prompt needs work |
| Agent answers about the pilot client that cite Brain documents | Spot-check 10 per week |
| Isolation or data-handling incidents | **Zero**. Any incident stops the pilot. |

**Choosing the pilot client:** an engaged pod, a client whose contract allows
AWS and Anthropic as subprocessors (check the MSA), and enough Grain calls (at
least weekly) for ingestion to matter.

---

## 7. Cost estimate (monthly, pilot scale)

| Item | Estimate |
|---|---|
| EC2 instance (2 vCPU, 4 GB) + 50 GB encrypted disk | ~$35 |
| VPC interface endpoint (Bedrock; one zone) | ~$8 |
| S3 backups, CloudTrail, snapshots | ~$5–10 |
| Bedrock (Claude) for ingestion | Usage-based; likely tens of dollars at pilot volume. We'll measure per meeting in week 1. |
| Tailscale | Depends on plan and user count; check current pricing |
| **Total** | **Roughly $50–80/month plus Tailscale and Bedrock usage** |

These are planning estimates from typical AWS pricing. Confirm with the AWS
pricing calculator for your region before deploying.

---

## 8. Decisions

**Resolved 2026-11-26:**

| Decision | Outcome |
|---|---|
| Access model | Tailscale, no public ports |
| Tailscale as a vendor | Approved |
| `@aws-sdk/client-bedrock-runtime` | Approved (installed) |
| OS security patches | Automatic, security only; app images stay pinned |
| Infrastructure as code | **OpenTofu** (open source, MPL-2.0), validated in CI |
| Network | **Public subnet with no inbound rules** instead of a private subnet + NAT (~$35/month saved, same exposure). Bedrock and S3 still use private endpoints. SSM over the internet (no SSM endpoints). |

**Still open:**

| # | Decision | My recommendation |
|---|---|---|
| 6 | Bedrock model for extraction | Mid-tier Claude first; compare against the smallest with `pnpm ingest:eval` |
| 7 | Region | US (`us-east-1` or `us-west-2`) unless a client contract requires EU |
| 8 | Pilot client and pod | Your call, using the criteria in §6 |

### Original decision list (for reference)

| # | Decision | My recommendation |
|---|---|---|
| 1 | Access model for the pilot | **Tailscale, no public ports.** Revisit when we want claude.ai/ChatGPT web connectors. |
| 2 | Approve Tailscale as a vendor | Yes. It carries encrypted traffic and sees connection metadata, not content. |
| 3 | Approve `@aws-sdk/client-bedrock-runtime` | Yes. Official AWS library, Apache-2.0. |
| 4 | OS security patches: automatic or monthly? | **Automatic for OS security patches only**, as a documented exception to SEC-SUP-4. App components stay pinned. |
| 5 | Infrastructure as code tool | **Terraform** (widely known, reviewable plans before any change). |
| 6 | Bedrock model for extraction | Start with the current mid-tier Claude model; compare against the smallest on the evaluation set to cut cost. |
| 7 | Region | US (`us-east-1` or `us-west-2`) unless a client contract requires EU. |
| 8 | Pilot client + pod | Your call, using the criteria in §6. |

---

## 9. Rollback and exit

- **Rollback a deploy:** images are pinned by digest; redeploy the previous digest.
- **Rollback a knowledge change:** revert the commit in Forgejo (normal review).
- **Stop the pilot:** revoke all agent tokens (`pnpm brain token revoke`), stop ingestion, keep the data.
- **Leave entirely:** every repository is plain Git with markdown. Export it with `git clone` and the knowledge is fully usable without any of our code.
