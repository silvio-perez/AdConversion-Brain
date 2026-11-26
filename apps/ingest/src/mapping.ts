import { readFileSync } from "node:fs";
import type { Meeting } from "./grain.ts";

export interface ClientMapping {
  internalDomains: string[];
  clients: Record<string, { domains: string[] }>;
}

export type MappingResult =
  | { kind: "client"; client: string }
  | { kind: "skip"; reason: "internal" | "unmapped" | "ambiguous"; detail: string };

export function loadMapping(file: string): ClientMapping {
  return JSON.parse(readFileSync(file, "utf8")) as ClientMapping;
}

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

/**
 * Decide which client a meeting belongs to from participants' email domains.
 * Exactly one client must match. Anything else is skipped, because filing a
 * call under the wrong client is a confidentiality breach (SEC-ISO-1).
 */
export function mapMeeting(meeting: Meeting, mapping: ClientMapping): MappingResult {
  const external = meeting.participants.filter(
    (p) => !p.internal && !mapping.internalDomains.includes(domainOf(p.email)),
  );
  if (external.length === 0)
    return { kind: "skip", reason: "internal", detail: "no external participants" };
  const matches = new Set<string>();
  const unknown = new Set<string>();
  for (const p of external) {
    const d = domainOf(p.email);
    const client = Object.entries(mapping.clients).find(([, c]) => c.domains.includes(d))?.[0];
    if (client) matches.add(client);
    else unknown.add(d);
  }
  if (matches.size === 0)
    return {
      kind: "skip",
      reason: "unmapped",
      detail: `unknown domains: ${[...unknown].join(", ")}`,
    };
  if (matches.size > 1)
    return {
      kind: "skip",
      reason: "ambiguous",
      detail: `matches ${[...matches].sort().join(" and ")}`,
    };
  return { kind: "client", client: [...matches][0] ?? "" };
}
