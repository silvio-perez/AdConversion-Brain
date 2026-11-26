# AdConversion Brain

Private, model-agnostic knowledge and intelligence platform for AdConversion employees and AI agents.

**Current phase:** technical discovery (no application code yet).

- [Technical discovery](docs/technical-discovery.md)
- [Architecture decision (proposed)](docs/architecture-decision.md)
- [Security requirements](docs/security-requirements.md)
- [Product roadmap](docs/product-roadmap.md)

Development uses synthetic data only.

## Development

Requirements: Node 22 (`.nvmrc`), pnpm via `corepack enable`, Git, and Docker (from Milestone 1).

```bash
pnpm install
pnpm env:check   # is this machine ready?
pnpm check       # lint, typecheck, tests, license policy

# Local stack (needs Docker)
pnpm stack:init && pnpm stack:up && pnpm stack:seed
pnpm test:stack  # prove client isolation
# Forgejo UI: http://localhost:3000 (credentials in deploy/local/.env)
```

AI coding agents: see [AGENTS.md](AGENTS.md).
