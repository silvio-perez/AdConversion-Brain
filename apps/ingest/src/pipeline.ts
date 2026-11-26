// Grain meeting -> client -> model -> verified learnings -> proposal for human review.
import { type BrainClient, BrainError } from "./brain-client.ts";
import type { Meeting, MeetingSource } from "./grain.ts";
import { type ClientMapping, mapMeeting } from "./mapping.ts";
import { buildPrompt, ExtractionSchema, type Model } from "./model.ts";
import { meetingDocPath, renderMeetingDoc } from "./render.ts";
import type { IngestState } from "./state.ts";
import { verifyEvidence } from "./verify.ts";

export interface MeetingReport {
  meetingId: string;
  outcome:
    | "proposed"
    | "no_learnings"
    | "already_done"
    | "skipped_internal"
    | "skipped_unmapped"
    | "skipped_ambiguous"
    | "skipped_not_in_scope"
    | "skipped_no_owner"
    | "invalid_model_output"
    | "error";
  client?: string;
  detail?: string;
  reviewUrl?: string;
  dropped?: number;
}

export interface PipelineDeps {
  meetings: MeetingSource;
  mapping: ClientMapping & { clients: Record<string, { domains: string[]; owner?: string }> };
  model: Model;
  brain: BrainClient;
  state: IngestState;
  dryRun?: boolean;
  log?: (line: string) => void;
  today?: string;
}

const CONTEXT_DOCS = ["business-context.md", "strategy.md"];
const MAX_CONTEXT = 4000;

export async function runIngestion(deps: PipelineDeps, since: Date): Promise<MeetingReport[]> {
  const log = deps.log ?? (() => {});
  const me = await deps.brain.whoami();
  if (me.mode !== "propose") throw new Error("Ingestion needs a propose-mode token.");
  // The token's vendor is what the gateway checked against each client's policy.
  // The model must be that same vendor, or the policy check would be meaningless.
  if (me.vendor !== deps.model.vendor)
    throw new Error(
      `Model vendor "${deps.model.vendor}" does not match token vendor "${me.vendor}".`,
    );
  const inScope = new Set(me.sources);

  const reports: MeetingReport[] = [];
  for (const meeting of await deps.meetings.meetings(since)) {
    const r = await processMeeting(deps, meeting, inScope);
    reports.push(r);
    // Log ids and outcomes only: never transcript text.
    log(
      `${meeting.id}: ${r.outcome}${r.client ? ` (${r.client})` : ""}${r.detail ? ` - ${r.detail}` : ""}`,
    );
  }
  return reports;
}

async function processMeeting(
  deps: PipelineDeps,
  meeting: Meeting,
  inScope: Set<string>,
): Promise<MeetingReport> {
  const base = { meetingId: meeting.id };
  if (deps.state.done(meeting.id)) return { ...base, outcome: "already_done" };

  const mapped = mapMeeting(meeting, deps.mapping);
  if (mapped.kind === "skip")
    return { ...base, outcome: `skipped_${mapped.reason}`, detail: mapped.detail };
  const client = mapped.client;
  const source = `client-${client}`;
  const owner = deps.mapping.clients[client]?.owner;

  // Checked BEFORE the transcript goes anywhere: the token's scope already
  // excludes clients whose vendor policy forbids this model's vendor.
  if (!inScope.has(source))
    return {
      ...base,
      client,
      outcome: "skipped_not_in_scope",
      detail: `${source} not in token scope (or vendor not approved)`,
    };
  if (!owner)
    return {
      ...base,
      client,
      outcome: "skipped_no_owner",
      detail: "no accountable owner in client mapping",
    };

  try {
    // Local state can be lost; the Brain's own proposal list can't. Never
    // re-send a transcript for a meeting that already has a live proposal.
    const path = meetingDocPath(meeting);
    const existing = (await deps.brain.proposals(source)).find(
      (p) => p.path === path && p.state !== "closed",
    );
    if (existing) {
      if (!deps.dryRun) deps.state.record(meeting.id, client, "proposed", existing.url);
      return {
        ...base,
        client,
        outcome: "already_done",
        detail: `existing proposal (${existing.state})`,
      };
    }

    const contextParts: string[] = [];
    for (const doc of CONTEXT_DOCS) {
      const body = await deps.brain.readBody(source, doc);
      if (body) contextParts.push(`# ${doc}\n${body}`);
    }
    const clientContext = contextParts.join("\n\n").slice(0, MAX_CONTEXT);

    const raw = await deps.model.extract({
      prompt: buildPrompt(meeting, clientContext),
      meeting,
      clientContext,
    });
    const parsed = ExtractionSchema.safeParse(raw);
    if (!parsed.success) {
      deps.state.record(meeting.id, client, "error", "invalid model output");
      return {
        ...base,
        client,
        outcome: "invalid_model_output",
        detail: parsed.error.issues[0]?.message ?? "",
      };
    }
    const { kept, dropped } = verifyEvidence(meeting, parsed.data);
    if (kept.length === 0) {
      if (!deps.dryRun)
        deps.state.record(meeting.id, client, "no_learnings", `${dropped.length} dropped`);
      return { ...base, client, outcome: "no_learnings", dropped: dropped.length };
    }

    const related = new Map<string, string[]>();
    for (const l of kept) related.set(l.title, await relatedDocs(deps.brain, source, l.statement));

    const today = deps.today ?? new Date().toISOString().slice(0, 10);
    const content = renderMeetingDoc({
      meeting,
      client,
      owner,
      learnings: kept,
      related,
      model: deps.model,
      today,
    });
    const summary =
      `${kept.length} learning(s) extracted from the Grain meeting "${meeting.title}" on ${meeting.startedAt.slice(0, 10)}.` +
      (dropped.length
        ? ` ${dropped.length} candidate(s) were discarded because their quotes could not be verified.`
        : "");
    if (deps.dryRun)
      return { ...base, client, outcome: "proposed", detail: "dry run", dropped: dropped.length };

    const res = await deps.brain.propose(source, {
      path: meetingDocPath(meeting),
      content,
      summary,
      evidence: kept
        .flatMap((l) => l.evidence.map((e) => ({ kind: "grain", ref: meeting.id, at: e.at })))
        .slice(0, 20),
    });
    deps.state.record(meeting.id, client, "proposed", res.reviewUrl);
    return {
      ...base,
      client,
      outcome: "proposed",
      reviewUrl: res.reviewUrl,
      dropped: dropped.length,
    };
  } catch (err) {
    // A document for this meeting already exists: someone already ingested it.
    if (
      err instanceof BrainError &&
      err.status === 422 &&
      JSON.stringify(err.body).includes("already exists")
    ) {
      deps.state.record(meeting.id, client, "proposed", "existing document");
      return { ...base, client, outcome: "already_done" };
    }
    deps.state.record(meeting.id, client, "error", (err as Error).message.slice(0, 200));
    return { ...base, client, outcome: "error", detail: (err as Error).message.slice(0, 200) };
  }
}

const STOP = new Set([
  "about",
  "after",
  "again",
  "their",
  "there",
  "these",
  "those",
  "which",
  "would",
  "could",
  "should",
  "from",
  "with",
  "that",
  "this",
  "have",
  "will",
  "into",
  "than",
]);

/**
 * Existing documents a reviewer should compare against. Searching for every
 * word of a sentence rarely matches anything, so search the few most
 * distinctive words separately and keep the documents that come up most often.
 */
export async function relatedDocs(
  brain: BrainClient,
  source: string,
  text: string,
): Promise<string[]> {
  const words = [...new Set(text.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? [])]
    .filter((w) => !STOP.has(w))
    .sort((a, b) => b.length - a.length)
    .slice(0, 4);
  const score = new Map<string, number>();
  for (const w of words)
    for (const hit of await brain.search(source, w, 3))
      score.set(hit.path, (score.get(hit.path) ?? 0) + 1);
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([path]) => path);
}
