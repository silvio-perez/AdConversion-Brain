import type { Meeting } from "./grain.ts";
import type { Extraction } from "./model.ts";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Phrases typical of attempts to instruct an AI through a transcript. A
 * learning that contains them is dropped and the reviewer never has to judge it.
 * Not a complete defence: human review remains the backstop (SEC-INT-3).
 */
const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) (instructions|rules)/i,
  /\b(system|developer) prompt\b/i,
  /\byou are now\b/i,
  /\b(mark|set) (it|this|status) (as )?approved\b/i,
  /\bwrite (the following )?(in)?to the [\w\s]+ knowledge base\b/i,
  /\bdisregard (the|your) (rules|instructions)\b/i,
];
export const looksLikeInjection = (text: string) => INJECTION_PATTERNS.some((re) => re.test(text));

/**
 * Keep only learnings whose every quote appears verbatim in the transcript at
 * (or within one segment of) the cited timestamp. Rejects hallucinated or
 * fabricated evidence before a human ever sees it.
 */
export function verifyEvidence(meeting: Meeting, extraction: Extraction) {
  const kept: Extraction["learnings"] = [];
  const dropped: { title: string; reason: string }[] = [];
  for (const l of extraction.learnings) {
    const bad = l.evidence.find((e) => {
      const i = meeting.segments.findIndex((s) => s.at === e.at);
      if (i < 0) return true;
      const window = meeting.segments
        .slice(Math.max(0, i - 1), i + 2)
        .map((s) => norm(s.text))
        .join(" ");
      return !window.includes(norm(e.quote));
    });
    const texts = [l.title, l.statement, ...l.evidence.map((e) => e.quote)];
    if (texts.some(looksLikeInjection))
      dropped.push({ title: l.title, reason: "suspected prompt injection" });
    else if (bad) dropped.push({ title: l.title, reason: `quote not found at ${bad.at}` });
    else kept.push(l);
  }
  return { kept, dropped };
}
