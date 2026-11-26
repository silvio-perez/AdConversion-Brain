// pnpm ingest [--since YYYY-MM-DD] [--dry-run]
// Env: INGEST_TOKEN (propose-mode Brain token), BRAIN_URL (default http://localhost:8787)
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { BrainClient } from "./brain-client.ts";
import { FixtureMeetingSource } from "./grain.ts";
import { loadMapping } from "./mapping.ts";
import { LocalRuleModel } from "./model.ts";
import { runIngestion } from "./pipeline.ts";
import { IngestState } from "./state.ts";

const ROOT = join(import.meta.dirname, "../../..");
const { values } = parseArgs({
  options: {
    since: {
      type: "string",
      default: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
    },
    source: { type: "string", default: "fixtures" },
    fixtures: { type: "string", default: join(ROOT, "fixtures/synthetic-grain/meetings.json") },
    model: { type: "string", default: "local" },
    "dry-run": { type: "boolean", default: false },
  },
});

const token = process.env.INGEST_TOKEN;
if (!token)
  throw new Error("Set INGEST_TOKEN to a propose-mode Brain token (see docs/ingestion.md).");
if (values.source !== "fixtures")
  throw new Error(
    "Only the synthetic fixture source exists until a Grain API key is approved (Milestone 6).",
  );
if (values.model !== "local" && values.model !== "bedrock")
  throw new Error("--model must be local or bedrock");
const bedrockModelId = process.env.INGEST_BEDROCK_MODEL;
if (values.model === "bedrock" && !bedrockModelId)
  throw new Error("Set INGEST_BEDROCK_MODEL to the Bedrock model or inference profile id.");

const statePath = process.env.INGEST_STATE ?? join(ROOT, "deploy/local/data/ingest.db");
mkdirSync(dirname(statePath), { recursive: true });

const reports = await runIngestion(
  {
    meetings: new FixtureMeetingSource(values.fixtures),
    mapping: loadMapping(
      process.env.INGEST_CLIENT_MAPPING ?? join(ROOT, "config/client-mapping.json"),
    ),
    model:
      values.model === "bedrock"
        ? await import("./bedrock.ts").then(
            ({ BedrockModel }) =>
              new BedrockModel({
                modelId: bedrockModelId ?? "",
                ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
              }),
          )
        : new LocalRuleModel({ vendor: "local" }),
    brain: new BrainClient({ url: process.env.BRAIN_URL ?? "http://localhost:8787", token }),
    state: new IngestState(statePath),
    dryRun: values["dry-run"],
    log: (line) => console.log(line),
  },
  new Date(values.since),
);
const proposed = reports.filter((r) => r.outcome === "proposed");
console.log(`\n${proposed.length} proposal(s)${values["dry-run"] ? " (dry run)" : ""}:`);
for (const r of proposed) console.log(`  ${r.client}: ${r.reviewUrl ?? r.detail}`);
