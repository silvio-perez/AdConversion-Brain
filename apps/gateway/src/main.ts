import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { Brain } from "./brain.ts";
import { loadConfig } from "./config.ts";
import { ForgejoSource } from "./content.ts";
import { createApp } from "./http.ts";
import { syncIndex } from "./indexer.ts";
import { loadVendorPolicy } from "./policy.ts";
import { openStore } from "./store.ts";

const cfg = loadConfig();
mkdirSync(dirname(cfg.dbPath), { recursive: true });
const db = openStore(cfg.dbPath);
const brain = new Brain(db, loadVendorPolicy(cfg.vendorPolicy));
const source = new ForgejoSource({
  url: cfg.forgejo.url,
  org: cfg.forgejo.org,
  token: cfg.forgejo.token(),
});

async function reindex() {
  try {
    const changed = await syncIndex(db, source);
    if (changed.length) console.log(`indexed: ${changed.join(", ")}`);
  } catch (err) {
    console.error("reindex failed:", (err as Error).message);
  }
}

await reindex();
setInterval(reindex, cfg.reindexSeconds * 1000).unref();

serve({ fetch: createApp({ db, brain }).fetch, hostname: cfg.host, port: cfg.port }, (info) =>
  console.log(`AdConversion Brain gateway on http://${info.address}:${info.port} (MCP at /mcp)`),
);
