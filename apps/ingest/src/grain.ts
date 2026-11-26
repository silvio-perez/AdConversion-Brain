// Where meetings come from. Production will read the Grain API; until a Grain
// key is approved, only the synthetic fixture source exists.
import { readFileSync } from "node:fs";

export interface Participant {
  name: string;
  email: string;
  internal: boolean;
}
export interface Segment {
  at: string; // "HH:MM:SS"
  speaker: string;
  text: string;
}
export interface Meeting {
  id: string;
  title: string;
  startedAt: string;
  participants: Participant[];
  segments: Segment[];
}

export interface MeetingSource {
  /** Meetings that started at or after `since`, oldest first. */
  meetings(since: Date): Promise<Meeting[]>;
}

export class FixtureMeetingSource implements MeetingSource {
  readonly #file: string;
  constructor(file: string) {
    this.#file = file;
  }
  async meetings(since: Date): Promise<Meeting[]> {
    const doc = JSON.parse(readFileSync(this.#file, "utf8")) as {
      synthetic?: boolean;
      meetings: Meeting[];
    };
    if (doc.synthetic !== true) throw new Error("Fixture meetings must be marked synthetic: true");
    return doc.meetings
      .filter((m) => new Date(m.startedAt) >= since)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }
}
