// Usage: BRAIN_TOKEN=brn_... pnpm skills [--add name] [--remove name] [--target dir] [--dry-run]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { syncSkills } from "./sync.ts";

const { values } = parseArgs({
  options: {
    add: { type: "string", multiple: true, default: [] },
    remove: { type: "string", multiple: true, default: [] },
    target: { type: "string", multiple: true, default: [] },
    "dry-run": { type: "boolean", default: false },
  },
});

const url = (process.env.BRAIN_URL ?? "http://localhost:8787").replace(/\/$/, "");
const token = process.env.BRAIN_TOKEN;
if (!token) {
  console.error("Set BRAIN_TOKEN (a Brain token that includes the 'skills' source).");
  process.exit(1);
}

// Remember which optional skills this person chose.
const stateFile = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "adconversion-brain",
  "skills.json",
);
const state = existsSync(stateFile)
  ? (JSON.parse(readFileSync(stateFile, "utf8")) as { optional: string[] })
  : { optional: [] as string[] };
const optional = [...new Set([...state.optional, ...values.add])].filter(
  (n) => !values.remove.includes(n),
);

const targets = values.target.length
  ? values.target
  : [join(homedir(), ".claude", "skills"), join(homedir(), ".agents", "skills")];

const report = await syncSkills({
  targets,
  optional,
  dryRun: values["dry-run"],
  fetchJson: async (path) => {
    const res = await fetch(`${url}${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return res.json();
  },
});

if (!values["dry-run"]) {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify({ optional }, null, 2)}\n`);
}
const show = (label: string, items: string[]) =>
  items.length && console.log(`${label}:\n  ${items.join("\n  ")}`);
if (values["dry-run"]) console.log("(dry run: nothing written)");
show("Installed", report.installed);
show("Updated", report.updated);
show("Unchanged", report.unchanged);
show("Removed", report.removed);
show("Skipped", report.skipped);
