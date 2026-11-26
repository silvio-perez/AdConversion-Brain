// pnpm ingest:eval [--model local|bedrock]
// Scores an extraction model on the synthetic evaluation set: does it find the
// facts that matter, and does anything forbidden survive our checks? Run before
// adopting or switching a model. Exit code 1 = below threshold.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { FixtureMeetingSource } from "./grain.ts";
import { buildPrompt, ExtractionSchema, LocalRuleModel, type Model } from "./model.ts";
import { verifyEvidence } from "./verify.ts";

const ROOT = join(import.meta.dirname, "../../..");

interface EvalCase {
  meetingId: string;
  client: string;
  mustFind: string[];
  mustNotContain: string[];
}

export async function evaluate(
  model: Model,
  opts: { evalFile?: string; meetingsFile?: string } = {},
) {
  const spec = JSON.parse(
    readFileSync(opts.evalFile ?? join(ROOT, "fixtures/synthetic-grain/eval.json"), "utf8"),
  ) as { thresholds: { minRecall: number; maxViolations: number }; cases: EvalCase[] };
  const meetings = await new FixtureMeetingSource(
    opts.meetingsFile ?? join(ROOT, "fixtures/synthetic-grain/meetings.json"),
  ).meetings(new Date(0));

  let expected = 0;
  let found = 0;
  let violations = 0;
  const rows: Record<string, string | number>[] = [];
  for (const c of spec.cases) {
    const meeting = meetings.find((m) => m.id === c.meetingId);
    if (!meeting) throw new Error(`eval case ${c.meetingId} has no meeting`);
    const context = ["business-context.md", "strategy.md"]
      .map((f) => join(ROOT, "fixtures/synthetic", `client-${c.client}`, f))
      .filter(existsSync)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n\n");
    const parsed = ExtractionSchema.safeParse(
      await model.extract({
        prompt: buildPrompt(meeting, context),
        meeting,
        clientContext: context,
      }),
    );
    const kept = parsed.success ? verifyEvidence(meeting, parsed.data).kept : [];
    const text = kept
      .map((l) => `${l.title} ${l.statement} ${l.evidence.map((e) => e.quote).join(" ")}`)
      .join("\n")
      .toLowerCase();
    const hits = c.mustFind.filter((f) => text.includes(f.toLowerCase())).length;
    const bad = c.mustNotContain.filter((f) => text.includes(f.toLowerCase()));
    expected += c.mustFind.length;
    found += hits;
    violations += bad.length;
    rows.push({
      meeting: c.meetingId,
      valid: parsed.success ? "yes" : "NO",
      kept: kept.length,
      found: `${hits}/${c.mustFind.length}`,
      violations: bad.join(", ") || "-",
    });
  }
  const recall = expected ? found / expected : 1;
  const pass = recall >= spec.thresholds.minRecall && violations <= spec.thresholds.maxViolations;
  return { rows, recall, violations, pass, thresholds: spec.thresholds };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { model: { type: "string", default: "local" } } });
  let model: Model;
  if (values.model === "bedrock") {
    const { BedrockModel } = await import("./bedrock.ts");
    const modelId = process.env.INGEST_BEDROCK_MODEL;
    if (!modelId) throw new Error("Set INGEST_BEDROCK_MODEL");
    model = new BedrockModel({
      modelId,
      ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
    });
  } else model = new LocalRuleModel({ vendor: "local" });

  const r = await evaluate(model);
  console.table(r.rows);
  console.log(
    `Model ${model.name}: recall ${(r.recall * 100).toFixed(0)}% (min ${r.thresholds.minRecall * 100}%), violations ${r.violations} (max ${r.thresholds.maxViolations}) -> ${r.pass ? "PASS" : "FAIL"}`,
  );
  if ("usage" in model) console.log("Token usage:", (model as { usage: unknown }).usage);
  process.exit(r.pass ? 0 : 1);
}
