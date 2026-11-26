# Connecting AI Tools to the Brain

The Brain speaks **MCP** (for Claude, Codex, Gemini CLI, Cursor and others) and
**REST** (for everything else). Every connection needs its own token.

## 1. Get a token (admin)

One token per person, per tool. The tool determines the vendor, and the vendor
must be approved for every client in `--sources` (`config/vendor-policy.json`).

```bash
pnpm brain token create --owner alice.synthetic --harness claude-code \
  --sources company,skills,client-acme-analytics --days 30
```

Add `--mode propose` for agents that should suggest changes. The owner must be
able to propose changes to every listed source in Forgejo (for example, Alice
can propose to her Acme pod's repository but not to `company`).

Harnesses: `claude-code`, `claude-desktop` (Anthropic), `codex-cli` (OpenAI),
`gemini-cli` (Google), `custom` (pass `--vendor`). Maximum lifetime is 90 days.
A token can never cover a source its owner cannot read in Forgejo.

The token is shown once. Store it in your shell profile or password manager as
`BRAIN_TOKEN`, never in a file inside a repository.

## 2. Connect your tool

Local endpoint: `http://localhost:8787/mcp` (production URL arrives in Milestone 6).

### Claude Code

```bash
claude mcp add --transport http brain http://localhost:8787/mcp \
  --header "Authorization: Bearer $BRAIN_TOKEN"
```

### OpenAI Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.brain]
url = "http://localhost:8787/mcp"
bearer_token_env_var = "BRAIN_TOKEN"
```

### Gemini CLI (`~/.gemini/settings.json`)

```json
{
  "mcpServers": {
    "brain": {
      "httpUrl": "http://localhost:8787/mcp",
      "headers": { "Authorization": "Bearer $BRAIN_TOKEN" }
    }
  }
}
```

### Anything else (REST)

OpenAPI spec: `GET /v1/openapi.json`. Send `Authorization: Bearer <token>`.

| Endpoint | Purpose |
|---|---|
| `GET /v1/whoami` | Identity, vendor, accessible sources, expiry |
| `GET /v1/sources` | Accessible knowledge sources |
| `GET /v1/sources/{source}/documents?prefix=` | List documents |
| `GET /v1/sources/{source}/documents/{path}` | Read one document |
| `GET /v1/search?q=&source=&limit=` | Full-text search |
| `GET /v1/skills` | Published skills |
| `GET /v1/skills/{name}` | Skill instructions + file list |
| `GET /v1/skills/{name}/files/{path}` | One skill file |
| `GET /v1/skills/{name}/bundle` | All files (used by `pnpm skills`) |
| `GET /v1/proposals?source=` | Recent proposals and their status |
| `POST /v1/sources/{source}/proposals` | Propose a change (propose tokens only) |

## 3. Tools available

| MCP tool | What it does |
|---|---|
| `whoami` | Shows what this connection can access |
| `list_sources` | `company`, `skills`, and the `client-*` sources you can see |
| `list_documents` | Documents in a source, optionally under a folder |
| `read_document` | Full document, metadata and `revision` |
| `search` | Full-text search with snippets |
| `list_proposals` | Recent proposals and whether they were merged |
| `list_skills` | Published skills, version, required/optional |
| `get_skill` | A skill's instructions and its file list |
| `read_skill_file` | One supporting file (template, example) |
| `propose_change` | **Propose tokens only.** Suggest an update; needs the `revision` from `read_document` |
| `propose_document` | **Propose tokens only.** Suggest a new document |

Proposals open a pull request for a human to review
(see `docs/reviewing-proposals.md`). Nothing changes until it is approved.
If the document changed after your agent read it, the proposal is refused and
the agent should read it again.

## 4. Verification status

| Harness | Status |
|---|---|
| MCP protocol (official SDK client) | **Verified** in CI: conformance and isolation tests on every push |
| Raw JSON-RPC over HTTP | **Verified** against the live stack |
| Claude Code, Codex CLI, Gemini CLI | **Config written, not yet run.** Needs each tool signed in with a company account on a machine that can reach the gateway. First task once the Brain runs on a laptop or server. |

## 5. Revoking access

```bash
pnpm brain token list
pnpm brain token revoke <first 8+ characters of the id>
```

Revocation takes effect on the next request.

## 6. Skills

Agents can load skills on demand (`list_skills` then `get_skill`), which works in
any MCP tool. To install them into a tool's own skills folder, see
`docs/publishing-skills.md` (`pnpm skills`).
