# AdConversion Brain

Private, model-agnostic knowledge and intelligence platform for AdConversion employees and AI agents.

**Current phase:** Phase 1 MVP. Milestones 0–2 complete (read-only MCP gateway).

- [Technical discovery](docs/technical-discovery.md)
- [Architecture decision (proposed)](docs/architecture-decision.md)
- [Security requirements](docs/security-requirements.md)
- [Product roadmap](docs/product-roadmap.md)
- [Connecting AI tools](docs/connecting-agents.md)
- [Knowledge conventions](docs/knowledge-conventions.md)

Development uses synthetic data only.

## Development

Requirements: Node 22 (`.nvmrc`), pnpm via `corepack enable`, Git, and Docker (from Milestone 1).

```bash
pnpm install
pnpm env:check   # is this machine ready?
pnpm check       # lint, typecheck, tests, license policy

# Local stack (needs Docker)
pnpm stack:init && pnpm stack:up && pnpm stack:seed
pnpm gateway     # Brain Gateway on http://localhost:8787 (MCP at /mcp)
pnpm test:stack  # prove client isolation (stack + gateway running)
# Forgejo UI: http://localhost:3000 (credentials in deploy/local/.env)
```

AI coding agents: see [AGENTS.md](AGENTS.md).
