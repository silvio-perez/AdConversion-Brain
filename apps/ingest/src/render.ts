import type { Meeting } from "./grain.ts";
import type { Extraction } from "./model.ts";

export function meetingDocPath(meeting: Meeting): string {
  const day = meeting.startedAt.slice(0, 10);
  const id = meeting.id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `learnings/${day}-meeting-${id}.md`;
}

const yamlString = (s: string) => JSON.stringify(s);

/** One learnings document per meeting, following the knowledge conventions. */
export function renderMeetingDoc(opts: {
  meeting: Meeting;
  client: string;
  owner: string;
  learnings: Extraction["learnings"];
  related: Map<string, string[]>;
  model: { name: string; vendor: string };
  today: string;
}): string {
  const { meeting, learnings } = opts;
  const day = meeting.startedAt.slice(0, 10);
  const speakerAt = new Map(meeting.segments.map((s) => [s.at, s.speaker]));
  const sections = learnings.map((l) => {
    const evidence = l.evidence
      .map((e) => `> [${e.at}] ${speakerAt.get(e.at) ?? "Unknown"}: ${e.quote.replace(/\n/g, " ")}`)
      .join("\n>\n");
    const related = opts.related.get(l.title) ?? [];
    return `## ${l.title.replace(/\n/g, " ")}

**Kind:** ${l.kind}

${l.statement.trim()}

${evidence}
${related.length ? `\nRelated knowledge: ${related.map((p) => `\`${p}\``).join(", ")}\n` : ""}`;
  });

  return `---
title: ${yamlString(`Meeting learnings: ${meeting.title} (${day})`)}
type: learning
client: ${opts.client}
owner: ${opts.owner}
status: draft
last_reviewed: ${opts.today}
sources:
  - kind: grain
    ref: ${yamlString(meeting.id)}
---

# ${meeting.title} (${day})

_Extracted automatically from the Grain recording by ${opts.model.name} (${opts.model.vendor}).
Every quote below was checked against the transcript; still spot-check the recording before approving._

${sections.join("\n")}`;
}
