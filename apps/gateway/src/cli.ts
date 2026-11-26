// Admin CLI: pnpm brain <command>. Run by an admin on the gateway host.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { Brain } from "./brain.ts";
import { loadConfig } from "./config.ts";
import { ForgejoSource } from "./content.ts";
import { syncIndex } from "./indexer.ts";
import { loadVendorPolicy, vendorAllowed } from "./policy.ts";
import { ForgejoWriter } from "./proposals.ts";
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

/**
 * An agent token may never do more than its human owner can. Asks Forgejo, as
 * the owner (admin "sudo"), what they may do in a repository.
 */
async function ownerAccess(
  owner: string,
  repo: string,
): Promise<{ read: boolean; write: boolean }> {
  const { username, password } = cfg.forgejo.admin();
  const res = await fetch(`${cfg.forgejo.url}/api/v1/repos/${cfg.forgejo.org}/${repo}`, {
    headers: {
      authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      sudo: owner,
    },
  });
  if (res.status !== 200) return { read: false, write: false };
  const { permissions } = (await res.json()) as {
    permissions?: { pull?: boolean; push?: boolean };
  };
  return { read: !!permissions?.pull, write: !!permissions?.push };
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
      mode: { type: "string", default: "read" },
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
  const mode = values.mode;
  if (mode !== "read" && mode !== "propose") throw new Error("--mode must be read or propose");
  const policy = loadVendorPolicy(cfg.vendorPolicy);

  for (const s of sources) {
    if (!vendorAllowed(policy, s, vendor))
      throw new Error(`${vendor} is not an approved vendor for ${s} (config/vendor-policy.json)`);
    const access = await ownerAccess(owner, s);
    if (!access.read)
      throw new Error(`${owner} cannot read ${s} in Forgejo, so their agent cannot either`);
    if (mode === "propose" && !access.write)
      throw new Error(
        `${owner} cannot propose changes to ${s} in Forgejo, so their agent cannot either`,
      );
  }
  const { token, record } = createToken(db, {
    name: values.name ?? `${owner}-${harness}`,
    owner,
    harness,
    vendor,
    sources,
    days: Number(values.days),
    mode,
  });
  console.log(
    `Created token ${record.id} for ${owner} (${harness}/${vendor}), expires ${record.expiresAt}`,
  );
  console.log(`Sources: ${record.sources.join(", ")} (mode: ${record.mode})`);
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
        mode: t.mode,
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
  case "reconcile": {
    const brain = new Brain(
      db,
      loadVendorPolicy(cfg.vendorPolicy),
      new ForgejoWriter({ ...cfg.forgejo, token: cfg.forgejo.proposerToken() }),
    );
    console.log(`Recorded ${await brain.reconcile()} proposal decision(s).`);
    break;
  }
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
  pnpm brain token create --owner <user> --harness <${Object.keys(HARNESSES).join("|")}> --sources a,b [--mode read|propose] [--days 1-${MAX_TOKEN_DAYS}] [--name n] [--vendor v]
  pnpm brain token list
  pnpm brain token revoke <id-prefix>
  pnpm brain reindex
  pnpm brain reconcile
  pnpm brain audit tail`);
}
