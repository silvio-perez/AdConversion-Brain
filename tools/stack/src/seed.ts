// Seeds the local Forgejo with the synthetic organisation described in
// docs/knowledge-conventions.md. Idempotent: safe to run repeatedly.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV_DIR, FORGEJO_URL, loadLocalEnv, ORG } from "./env.ts";
import { basicAuth, type Credentials, forgejo } from "./forgejo.ts";

const env = loadLocalEnv();
const admin: Credentials = {
  username: env.FORGEJO_ADMIN_USER ?? "brain-admin",
  password: env.FORGEJO_ADMIN_PASSWORD ?? "",
};
const userPassword = env.SYNTHETIC_USER_PASSWORD ?? "";
if (!admin.password || !userPassword) throw new Error("Run `pnpm stack:init` first.");

const FIXTURES = join(import.meta.dirname, "../../../fixtures/synthetic");
const GATEWAY_ENV = join(ENV_DIR, "gateway.env");
const FORGEJO_CONTAINER = process.env.FORGEJO_CONTAINER ?? "brain-local-forgejo-1";
const REPOS = ["company", "skills", "client-acme-analytics", "client-globex-cloud"];
// dave.synthetic exists only for tests that change team membership.
const USERS = ["alice.synthetic", "bob.synthetic", "carol.synthetic", "dave.synthetic"];

/**
 * Human teams. `reviews` lists the repositories where this team's approval
 * counts. Only human teams appear here, so a bot approval never counts.
 */
const TEAMS = [
  {
    name: "all-staff",
    permission: "read",
    repos: ["company", "skills"],
    members: USERS,
    reviews: [],
  },
  {
    name: "knowledge-admins",
    permission: "write",
    repos: ["company", "skills"],
    members: ["carol.synthetic"],
    reviews: ["company", "skills"],
  },
  {
    name: "pod-acme",
    permission: "write",
    repos: ["client-acme-analytics"],
    members: ["alice.synthetic", "dave.synthetic"],
    reviews: ["client-acme-analytics"],
  },
  {
    // Service identity for Grain ingestion: may PROPOSE to client repositories
    // (Forgejo write is needed to open PRs), never approve (not on any approver list).
    name: "ingestion",
    permission: "write",
    repos: ["client-acme-analytics", "client-globex-cloud"],
    members: ["brain-ingest"],
    reviews: [],
  },
  {
    name: "pod-globex",
    permission: "write",
    repos: ["client-globex-cloud"],
    members: ["bob.synthetic"],
    reviews: ["client-globex-cloud"],
  },
] as const;
const UNITS = ["repo.code", "repo.pulls", "repo.issues", "repo.releases"];

/**
 * Service accounts used by the gateway. Each gets the narrowest Forgejo scope
 * that does its job; branch protection stops both from touching `main`.
 */
const SERVICE_ACCOUNTS = [
  {
    user: "brain-gateway",
    team: "gateway-readers",
    permission: "read",
    envKey: "FORGEJO_GATEWAY_TOKEN",
    scopes: ["read:repository", "read:organization"],
  },
  {
    user: "brain-proposer",
    team: "proposers",
    permission: "write",
    envKey: "FORGEJO_PROPOSER_TOKEN",
    scopes: ["write:repository", "read:organization"],
  },
] as const;

const api = forgejo(admin);
const log = (msg: string) => console.log(`  ${msg}`);

function expectOk(res: { status: number; json: unknown }, what: string, allowed: number[] = []) {
  if (res.status >= 400 && !allowed.includes(res.status))
    throw new Error(`${what} failed (${res.status}): ${JSON.stringify(res.json)}`);
}

function readGatewayEnv(): Record<string, string> {
  if (!existsSync(GATEWAY_ENV)) return {};
  return Object.fromEntries(
    readFileSync(GATEWAY_ENV, "utf8")
      .split("\n")
      .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1], m[2]]),
  );
}

function writeGatewayEnv(values: Record<string, string>) {
  const text = Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(GATEWAY_ENV, `${text}\n`, { mode: 0o600 });
}

function ensureAdmin() {
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "-u",
        "git",
        FORGEJO_CONTAINER,
        "forgejo",
        "admin",
        "user",
        "create",
        "--admin",
        "--username",
        admin.username,
        "--password",
        admin.password,
        "--email",
        `${admin.username}@brain.local`,
        "--must-change-password=false",
      ],
      { stdio: "pipe" },
    );
    log(`created admin ${admin.username}`);
  } catch (err) {
    if (!String((err as { stderr?: Buffer }).stderr).includes("already exists")) throw err;
    log(`admin ${admin.username} exists`);
  }
}

async function ensureUser(username: string, password = userPassword) {
  const res = await api("POST", "/admin/users", {
    username,
    email: `${username}@brain.local`,
    password,
    must_change_password: false,
    visibility: "private",
  });
  expectOk(res, `create user ${username}`, [422]);
  log(res.status === 422 ? `user ${username} exists` : `created user ${username}`);
}

async function ensureOrg() {
  const res = await api("POST", "/orgs", { username: ORG, visibility: "private" });
  expectOk(res, "create org", [422]);
  log(res.status === 422 ? `org ${ORG} exists` : `created org ${ORG}`);
}

async function ensureRepo(name: string) {
  const res = await api("POST", `/orgs/${ORG}/repos`, {
    name,
    private: true,
    auto_init: false,
    default_branch: "main",
  });
  expectOk(res, `create repo ${name}`, [409]);
  log(res.status === 409 ? `repo ${name} exists` : `created repo ${name}`);
}

function pushFixtures(name: string) {
  const dir = mkdtempSync(join(tmpdir(), "brain-seed-"));
  try {
    cpSync(join(FIXTURES, name), dir, { recursive: true });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git(
      "-c",
      "user.name=Brain Seed",
      "-c",
      "user.email=seed@brain.local",
      "commit",
      "-q",
      "-m",
      "Seed synthetic knowledge",
    );
    git(
      "-c",
      `http.extraHeader=Authorization: ${basicAuth(admin)}`,
      "push",
      "-q",
      `${FORGEJO_URL}/${ORG}/${name}.git`,
      "main",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function ensureContent(name: string) {
  const res = await api("GET", `/repos/${ORG}/${name}`);
  expectOk(res, `get repo ${name}`);
  if ((res.json as { empty: boolean }).empty) {
    pushFixtures(name);
    log(`pushed fixtures to ${name}`);
  } else log(`${name} already has content`);
}

async function findTeam(name: string): Promise<{ id: number; name: string } | undefined> {
  const list = await api("GET", `/orgs/${ORG}/teams`);
  expectOk(list, "list teams");
  return (list.json as { id: number; name: string }[]).find((t) => t.name === name);
}

async function ensureTeam(opts: {
  name: string;
  permission: string;
  repos: readonly string[] | "all";
  members: readonly string[];
}) {
  let team = await findTeam(opts.name);
  if (!team) {
    const units = opts.permission === "read" && opts.repos === "all" ? ["repo.code"] : UNITS;
    const res = await api("POST", `/orgs/${ORG}/teams`, {
      name: opts.name,
      permission: opts.permission,
      includes_all_repositories: opts.repos === "all",
      can_create_org_repo: false,
      units,
      units_map: Object.fromEntries(units.map((u) => [u, opts.permission])),
    });
    expectOk(res, `create team ${opts.name}`);
    team = res.json as { id: number; name: string };
    log(`created team ${opts.name} (${opts.permission})`);
  }
  if (opts.repos !== "all")
    for (const repo of opts.repos)
      expectOk(await api("PUT", `/teams/${team.id}/repos/${ORG}/${repo}`), `add ${repo}`);
  for (const user of opts.members)
    expectOk(await api("PUT", `/teams/${team.id}/members/${user}`), `add ${user}`);
  log(
    `team ${opts.name}: ${opts.repos === "all" ? "all repos" : `[${opts.repos.join(", ")}]`}, members [${opts.members.join(", ")}]`,
  );
}

/** Protect `main`: PR-only, one approval, and only approvals from the right human team count. */
async function ensureProtection(repo: string) {
  const reviewers = TEAMS.filter((t) => (t.reviews as readonly string[]).includes(repo)).map(
    (t) => t.name,
  );
  const rule = {
    enable_push: false, // nobody pushes directly, including admins and bots
    required_approvals: 1,
    block_on_rejected_reviews: true,
    dismiss_stale_approvals: true,
    apply_to_admins: true,
    enable_approvals_whitelist: true,
    approvals_whitelist_teams: reviewers,
  };
  const created = await api("POST", `/repos/${ORG}/${repo}/branch_protections`, {
    rule_name: "main",
    ...rule,
  });
  if (created.status >= 400) {
    expectOk(created, `protect ${repo}`, [403, 409, 422]);
    expectOk(
      await api("PATCH", `/repos/${ORG}/${repo}/branch_protections/main`, rule),
      `update protection ${repo}`,
    );
  }
  log(`protected ${repo}/main (approvals count from: ${reviewers.join(", ")})`);
}

async function ensureServiceAccount(
  acct: (typeof SERVICE_ACCOUNTS)[number],
  envValues: Record<string, string>,
) {
  const password = randomBytes(24).toString("base64url");
  await ensureUser(acct.user, password);
  await ensureTeam({
    name: acct.team,
    permission: acct.permission,
    repos: "all",
    members: [acct.user],
  });
  if (envValues[acct.envKey]) return;
  // A fresh password is used once to mint the token, then forgotten.
  expectOk(
    await api("PATCH", `/admin/users/${acct.user}`, {
      password,
      login_name: acct.user,
      source_id: 0,
    }),
    `reset ${acct.user} password`,
  );
  const self = forgejo({ username: acct.user, password });
  await self("DELETE", `/users/${acct.user}/tokens/gateway`);
  const tok = await self("POST", `/users/${acct.user}/tokens`, {
    name: "gateway",
    scopes: acct.scopes,
  });
  expectOk(tok, `create ${acct.user} token`);
  envValues[acct.envKey] = (tok.json as { sha1: string }).sha1;
  log(`created ${acct.user} token (${acct.scopes.join(", ")})`);
}

/** Only knowledge admins may create release tags: publishing a skill is a human decision. */
async function ensureTagProtection() {
  const list = await api("GET", `/repos/${ORG}/skills/tag_protections`);
  expectOk(list, "list tag protections");
  if ((list.json as { name_pattern: string }[]).some((p) => p.name_pattern === "*")) {
    log("skills tags protected (knowledge-admins only)");
    return;
  }
  expectOk(
    await api("POST", `/repos/${ORG}/skills/tag_protections`, {
      name_pattern: "*",
      whitelist_teams: ["knowledge-admins"],
    }),
    "protect skills tags",
  );
  log("protected skills tags (knowledge-admins only)");
}

/** Publish v1 of every skill on main that has no release yet, as Carol (a knowledge admin). */
async function ensureInitialReleases() {
  const carol = forgejo({ username: "carol.synthetic", password: userPassword });
  const tags = await carol("GET", `/repos/${ORG}/skills/tags?limit=50`);
  expectOk(tags, "list skill tags");
  const existing = new Set((tags.json as { name: string }[]).map((t) => t.name.split("/")[0]));
  const tree = await carol("GET", `/repos/${ORG}/skills/git/trees/main?recursive=true`);
  const skills = (tree.json as { tree: { path: string }[] }).tree
    .map((e) => /^([a-z0-9-]+)\/SKILL\.md$/.exec(e.path)?.[1])
    .filter((n): n is string => !!n);
  for (const name of skills.filter((n) => !existing.has(n))) {
    expectOk(
      await carol("POST", `/repos/${ORG}/skills/tags`, {
        tag_name: `${name}/v1`,
        target: "main",
        message: `Publish ${name} v1`,
      }),
      `publish ${name}`,
    );
    log(`published ${name}/v1 (as carol.synthetic)`);
  }
}

console.log(`Seeding ${FORGEJO_URL}`);
ensureAdmin();
for (const u of USERS) await ensureUser(u);
await ensureOrg();
for (const r of REPOS) {
  await ensureRepo(r);
  await ensureContent(r);
}
await ensureUser("brain-ingest", randomBytes(24).toString("base64url"));
for (const t of TEAMS) await ensureTeam(t);
for (const r of REPOS) await ensureProtection(r);
await ensureTagProtection();
await ensureInitialReleases();

const envValues = readGatewayEnv();
for (const acct of SERVICE_ACCOUNTS) await ensureServiceAccount(acct, envValues);
writeGatewayEnv(envValues);
console.log(`Done. Sign in at ${FORGEJO_URL} (credentials in ${join(ENV_DIR, ".env")}).`);
