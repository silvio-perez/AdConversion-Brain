// Installs published Brain skills into AI tools' skills folders
// (~/.claude/skills, ~/.agents/skills, ...). Zero dependencies.
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const MARKER = ".brain-skill.json";

interface SkillListItem {
  name: string;
  version: number;
  tag: string;
  status: "required" | "optional";
}
interface Bundle extends SkillListItem {
  contents: { path: string; content: string; sha256: string }[];
}
interface Marker {
  source: "adconversion-brain";
  name: string;
  version: number;
  tag: string;
  installedAt: string;
}

export interface SyncOptions {
  /** GET a gateway path (e.g. "/v1/skills") with the user's token; returns parsed JSON. */
  fetchJson: (path: string) => Promise<unknown>;
  targets: string[];
  /** Optional skills this person opted into. */
  optional: string[];
  dryRun?: boolean;
}

export interface SyncReport {
  installed: string[];
  updated: string[];
  unchanged: string[];
  removed: string[];
  skipped: string[];
}

/** Relative paths only: no absolute paths, traversal or hidden segments. */
export function safeRelativePath(p: string): boolean {
  if (!p || p.startsWith("/") || p.includes("\\") || p.includes("\0")) return false;
  return p
    .split("/")
    .every((seg) => seg.length > 0 && seg !== "." && seg !== ".." && !seg.startsWith("."));
}
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readMarker(dir: string): Marker | null {
  try {
    const m = JSON.parse(readFileSync(join(dir, MARKER), "utf8")) as Marker;
    return m.source === "adconversion-brain" ? m : null;
  } catch {
    return null;
  }
}

export async function syncSkills(opts: SyncOptions): Promise<SyncReport> {
  const report: SyncReport = {
    installed: [],
    updated: [],
    unchanged: [],
    removed: [],
    skipped: [],
  };
  const { skills } = (await opts.fetchJson("/v1/skills")) as { skills: SkillListItem[] };
  const wanted = skills.filter((s) => s.status === "required" || opts.optional.includes(s.name));
  for (const name of opts.optional)
    if (!skills.some((s) => s.name === name)) report.skipped.push(`${name}: not a published skill`);

  const bundles = new Map<string, Bundle>();
  for (const s of wanted) {
    if (!SKILL_NAME.test(s.name)) {
      report.skipped.push(`${s.name}: invalid name`);
      continue;
    }
    const b = (await opts.fetchJson(`/v1/skills/${encodeURIComponent(s.name)}/bundle`)) as Bundle;
    const bad = b.contents.find(
      (f) =>
        !safeRelativePath(f.path) ||
        createHash("sha256").update(f.content).digest("hex") !== f.sha256,
    );
    if (bad) {
      report.skipped.push(`${s.name}: refused unsafe or corrupted file ${bad.path}`);
      continue;
    }
    bundles.set(s.name, b);
  }

  for (const target of opts.targets) {
    if (!opts.dryRun) mkdirSync(target, { recursive: true });
    for (const b of bundles.values()) {
      const dest = join(target, b.name);
      const label = `${dest} (v${b.version})`;
      const marker = existsSync(dest) ? readMarker(dest) : null;
      if (existsSync(dest) && !marker) {
        report.skipped.push(`${dest}: exists and was not installed by the Brain; left untouched`);
        continue;
      }
      if (marker?.version === b.version) {
        report.unchanged.push(label);
        continue;
      }
      (marker ? report.updated : report.installed).push(label);
      if (opts.dryRun) continue;

      // Write to a temporary folder, then swap it in.
      const tmp = `${dest}.brain-tmp-${randomBytes(4).toString("hex")}`;
      try {
        for (const f of b.contents) {
          const file = join(tmp, ...f.path.split("/"));
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, f.content);
        }
        const m: Marker = {
          source: "adconversion-brain",
          name: b.name,
          version: b.version,
          tag: b.tag,
          installedAt: new Date().toISOString(),
        };
        writeFileSync(join(tmp, MARKER), `${JSON.stringify(m, null, 2)}\n`);
        if (marker) rmSync(dest, { recursive: true, force: true });
        renameSync(tmp, dest);
      } catch (err) {
        rmSync(tmp, { recursive: true, force: true });
        throw err;
      }
    }

    // Remove Brain-installed skills that are no longer wanted or published.
    if (!existsSync(target)) continue;
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      if (!entry.isDirectory() || bundles.has(entry.name)) continue;
      const dir = join(target, entry.name);
      if (!readMarker(dir)) continue; // never touch folders we didn't create
      report.removed.push(dir);
      if (!opts.dryRun) rmSync(dir, { recursive: true, force: true });
    }
  }
  return report;
}
