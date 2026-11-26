import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { Brain } from "./brain.ts";
import { loadConfig } from "./config.ts";
import { ForgejoSource } from "./content.ts";
import { createApp } from "./http.ts";
import { syncIndex } from "./indexer.ts";
import { loadVendorPolicy } from "./policy.ts";
import { ForgejoWriter } from "./proposals.ts";
import { ForgejoSkillSource, syncSkills } from "./skills.ts";
import { openStore } from "./store.ts";

const cfg = loadConfig();
mkdirSync(dirname(cfg.dbPath), { recursive: true });
const db = openStore(cfg.dbPath);
const source = new ForgejoSource({
  url: cfg.forgejo.url,
  org: cfg.forgejo.org,
  token: cfg.forgejo.token(),
});
// Separate credential for proposals: can open branches and PRs, never merge.
const writer = new ForgejoWriter({
  url: cfg.forgejo.url,
  org: cfg.forgejo.org,
  token: cfg.forgejo.proposerToken(),
});
const brain = new Brain(db, loadVendorPolicy(cfg.vendorPolicy), writer);
const skillSource = new ForgejoSkillSource({
  url: cfg.forgejo.url,
  org: cfg.forgejo.org,
  token: cfg.forgejo.token(),
});

async function reindex() {
  try {
    const changed = await syncIndex(db, source);
    if (changed.length) console.log(`indexed: ${changed.join(", ")}`);
    const skills = await syncSkills(db, skillSource);
    if (skills.length) console.log(`published skills: ${skills.join(", ")}`);
    const decisions = await brain.reconcile();
    if (decisions) console.log(`recorded ${decisions} proposal decision(s)`);
  } catch (err) {
    console.error("reindex failed:", (err as Error).message);
  }
}

await reindex();
setInterval(reindex, cfg.reindexSeconds * 1000).unref();

serve({ fetch: createApp({ db, brain }).fetch, hostname: cfg.host, port: cfg.port }, (info) =>
  console.log(`AdConversion Brain gateway on http://${info.address}:${info.port} (MCP at /mcp)`),
);
