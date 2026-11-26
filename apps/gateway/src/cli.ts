// Admin CLI: pnpm brain <command>. Run by an admin on the gateway host.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "./config.ts";
import { ForgejoSource } from "./content.ts";
import { syncIndex } from "./indexer.ts";
import { loadVendorPolicy, vendorAllowed } from "./policy.ts";
import { openStore } from "./store.ts";
import { createToken, listTokens, MAX_TOKEN_DAYS, revokeToken } from "./tokens.ts";

const HARNESSES: Record<string, string> = {
  "claude-code": "anthropic",
  "claude-desktop": "anthropic",
  "codex-cli": "openai",
  "gemini-cli": "google",
  custom: "",
};

const cfg = loadConfig();
mkdirSync(dirname(cfg.dbPath), { recursive: true });
const db = openStore(cfg.dbPath);
const [command, sub, ...rest] = process.argv.slice(2);

/** An agent token may never see more than its human owner can (checked in Forgejo). */
async function ownerCanRead(owner: string, repo: string): Promise<boolean> {
  const { username, password } = cfg.forgejo.admin();
  const res = await fetch(`${cfg.forgejo.url}/api/v1/repos/${cfg.forgejo.org}/${repo}`, {
    headers: {
      authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      sudo: owner,
    },
  });
  return res.status === 200;
}

async function tokenCreate(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      name: { type: "string" },
      owner: { type: "string" },
      harness: { type: "string" },
      vendor: { type: "string" },
      sources: { type: "string" },
      days: { type: "string", default: "30" },
    },
  });
  const harness = values.harness ?? "";
  if (!(harness in HARNESSES))
    throw new Error(`--harness must be one of: ${Object.keys(HARNESSES).join(", ")}`);
  const vendor = values.vendor ?? HARNESSES[harness] ?? "";
  if (!vendor) throw new Error("--vendor is required for custom harnesses");
  const owner = values.owner ?? "";
  const sources = (values.sources ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const policy = loadVendorPolicy(cfg.vendorPolicy);

  for (const s of sources) {
    if (!vendorAllowed(policy, s, vendor))
      throw new Error(`${vendor} is not an approved vendor for ${s} (config/vendor-policy.json)`);
    if (!(await ownerCanRead(owner, s)))
      throw new Error(`${owner} cannot read ${s} in Forgejo, so their agent cannot either`);
  }
  const { token, record } = createToken(db, {
    name: values.name ?? `${owner}-${harness}`,
    owner,
    harness,
    vendor,
    sources,
    days: Number(values.days),
  });
  console.log(
    `Created token ${record.id} for ${owner} (${harness}/${vendor}), expires ${record.expiresAt}`,
  );
  console.log(`Sources: ${record.sources.join(", ")}`);
  console.log("\nCopy it now. It will not be shown again:\n");
  console.log(token);
}

switch (`${command} ${sub ?? ""}`.trim()) {
  case "token create":
    await tokenCreate(rest);
    break;
  case "token list":
    console.table(
      listTokens(db).map((t) => ({
        id: t.id.slice(0, 8),
        name: t.name,
        owner: t.owner,
        harness: t.harness,
        sources: t.sources.join(","),
        expires: t.expiresAt.slice(0, 10),
        revoked: t.revokedAt ? t.revokedAt.slice(0, 10) : "",
      })),
    );
    break;
  case "token revoke": {
    const prefix = rest[0] ?? "";
    const match = listTokens(db).filter((t) => prefix.length >= 8 && t.id.startsWith(prefix));
    if (match.length !== 1 || !match[0])
      throw new Error("Give at least 8 characters of exactly one token id");
    console.log(revokeToken(db, match[0].id) ? `Revoked ${match[0].id}` : "Already revoked");
    break;
  }
  case "reindex":
    console.log(
      await syncIndex(db, new ForgejoSource({ ...cfg.forgejo, token: cfg.forgejo.token() })),
    );
    break;
  case "audit tail":
    console.table(
      db
        .prepare(
          "SELECT ts, owner, harness, action, source, resource, result FROM audit ORDER BY id DESC LIMIT 20",
        )
        .all(),
    );
    break;
  default:
    console.log(`Usage:
  pnpm brain token create --owner <user> --harness <${Object.keys(HARNESSES).join("|")}> --sources a,b [--days 1-${MAX_TOKEN_DAYS}] [--name n] [--vendor v]
  pnpm brain token list
  pnpm brain token revoke <id-prefix>
  pnpm brain reindex
  pnpm brain audit tail`);
}
