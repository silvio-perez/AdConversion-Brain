// Seeds the local Forgejo with the synthetic organisation described in
// docs/knowledge-conventions.md. Idempotent: safe to run repeatedly.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FORGEJO_URL, loadLocalEnv, ORG } from "./env.ts";
import { basicAuth, type Credentials, forgejo } from "./forgejo.ts";

const env = loadLocalEnv();
const admin: Credentials = {
  username: env.FORGEJO_ADMIN_USER ?? "brain-admin",
  password: env.FORGEJO_ADMIN_PASSWORD ?? "",
};
const userPassword = env.SYNTHETIC_USER_PASSWORD ?? "";
if (!admin.password || !userPassword) throw new Error("Run `pnpm stack:init` first.");

const FIXTURES = join(import.meta.dirname, "../../../fixtures/synthetic");
const REPOS = ["company", "skills", "client-acme-analytics", "client-globex-cloud"];
const USERS = ["alice.synthetic", "bob.synthetic"];
const TEAMS = [
  { name: "all-staff", permission: "read", repos: ["company", "skills"], members: USERS },
  {
    name: "pod-acme",
    permission: "write",
    repos: ["client-acme-analytics"],
    members: ["alice.synthetic"],
  },
  {
    name: "pod-globex",
    permission: "write",
    repos: ["client-globex-cloud"],
    members: ["bob.synthetic"],
  },
] as const;
const UNITS = ["repo.code", "repo.pulls", "repo.issues", "repo.releases"];

const api = forgejo(admin);
const log = (msg: string) => console.log(`  ${msg}`);

function expectOk(res: { status: number; json: unknown }, what: string, allowed: number[] = []) {
  if (res.status >= 400 && !allowed.includes(res.status))
    throw new Error(`${what} failed (${res.status}): ${JSON.stringify(res.json)}`);
}

function ensureAdmin() {
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "-u",
        "git",
        "brain-local-forgejo-1",
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

async function ensureUser(username: string) {
  const res = await api("POST", "/admin/users", {
    username,
    email: `${username}@brain.local`,
    password: userPassword,
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

async function ensureProtection(name: string) {
  const res = await api("POST", `/repos/${ORG}/${name}/branch_protections`, {
    rule_name: "main",
    enable_push: false, // nobody pushes directly: every change is a reviewed PR
    required_approvals: 1,
    block_on_rejected_reviews: true,
    dismiss_stale_approvals: true,
    apply_to_admins: true,
  });
  expectOk(res, `protect ${name}`, [403, 409, 422]);
  log(res.status < 400 ? `protected ${name}/main` : `${name}/main already protected`);
}

async function ensureTeam(team: (typeof TEAMS)[number]) {
  const list = await api("GET", `/orgs/${ORG}/teams`);
  expectOk(list, "list teams");
  let found = (list.json as { id: number; name: string }[]).find((t) => t.name === team.name);
  if (!found) {
    const res = await api("POST", `/orgs/${ORG}/teams`, {
      name: team.name,
      permission: team.permission,
      includes_all_repositories: false,
      can_create_org_repo: false,
      units: UNITS,
      units_map: Object.fromEntries(UNITS.map((u) => [u, team.permission])),
    });
    expectOk(res, `create team ${team.name}`);
    found = res.json as { id: number; name: string };
    log(`created team ${team.name} (${team.permission})`);
  }
  for (const repo of team.repos)
    expectOk(await api("PUT", `/teams/${found.id}/repos/${ORG}/${repo}`), `add ${repo}`);
  for (const user of team.members)
    expectOk(await api("PUT", `/teams/${found.id}/members/${user}`), `add ${user}`);
  log(`team ${team.name}: repos [${team.repos.join(", ")}], members [${team.members.join(", ")}]`);
}

// The gateway reads every repository through its own read-only account and
// enforces per-client scope itself (defence in depth: it can never write).
const GATEWAY_USER = "brain-gateway";
const GATEWAY_ENV = join(import.meta.dirname, "../../../deploy/local/gateway.env");

async function ensureGatewayAccount() {
  const password = randomBytes(24).toString("base64url");
  const created = await api("POST", "/admin/users", {
    username: GATEWAY_USER,
    email: `${GATEWAY_USER}@brain.local`,
    password,
    must_change_password: false,
    visibility: "private",
  });
  expectOk(created, "create gateway user", [422]);

  const list = await api("GET", `/orgs/${ORG}/teams`);
  let team = (list.json as { id: number; name: string }[]).find(
    (t) => t.name === "gateway-readers",
  );
  if (!team) {
    const res = await api("POST", `/orgs/${ORG}/teams`, {
      name: "gateway-readers",
      permission: "read",
      includes_all_repositories: true,
      can_create_org_repo: false,
      units: ["repo.code"],
      units_map: { "repo.code": "read" },
    });
    expectOk(res, "create gateway-readers team");
    team = res.json as { id: number; name: string };
  }
  expectOk(await api("PUT", `/teams/${team.id}/members/${GATEWAY_USER}`), "add gateway to team");

  if (existsSync(GATEWAY_ENV)) {
    log("gateway account ready (token already in deploy/local/gateway.env)");
    return;
  }
  // Fresh password used once to mint a token, then forgotten.
  expectOk(
    await api("PATCH", `/admin/users/${GATEWAY_USER}`, {
      password,
      login_name: GATEWAY_USER,
      source_id: 0,
    }),
    "reset gateway password",
  );
  const asGateway = forgejo({ username: GATEWAY_USER, password });
  await asGateway("DELETE", `/users/${GATEWAY_USER}/tokens/gateway`);
  const tok = await asGateway("POST", `/users/${GATEWAY_USER}/tokens`, {
    name: "gateway",
    scopes: ["read:repository", "read:organization"],
  });
  expectOk(tok, "create gateway token");
  writeFileSync(GATEWAY_ENV, `FORGEJO_GATEWAY_TOKEN=${(tok.json as { sha1: string }).sha1}\n`, {
    mode: 0o600,
  });
  log("created read-only gateway token -> deploy/local/gateway.env");
}

console.log(`Seeding ${FORGEJO_URL}`);
ensureAdmin();
for (const u of USERS) await ensureUser(u);
await ensureOrg();
for (const r of REPOS) {
  await ensureRepo(r);
  await ensureContent(r);
  await ensureProtection(r);
}
for (const t of TEAMS) await ensureTeam(t);
await ensureGatewayAccount();
console.log("Done. Sign in at http://localhost:3000 (credentials in deploy/local/.env).");
