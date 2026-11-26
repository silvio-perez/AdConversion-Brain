import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../../..");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. Did you run pnpm stack:seed?`);
  return v;
}

export function loadConfig() {
  return {
    host: process.env.BRAIN_HOST ?? "127.0.0.1",
    port: Number(process.env.BRAIN_PORT ?? 8787),
    dbPath: process.env.BRAIN_DB ?? join(ROOT, "deploy/local/data/gateway.db"),
    vendorPolicy: process.env.BRAIN_VENDOR_POLICY ?? join(ROOT, "config/vendor-policy.json"),
    reindexSeconds: Number(process.env.BRAIN_REINDEX_SECONDS ?? 30),
    forgejo: {
      url: process.env.FORGEJO_URL ?? "http://localhost:3000",
      org: process.env.FORGEJO_ORG ?? "adconversion",
      token: () => need("FORGEJO_GATEWAY_TOKEN"),
      admin: () => ({
        username: need("FORGEJO_ADMIN_USER"),
        password: need("FORGEJO_ADMIN_PASSWORD"),
      }),
    },
  };
}
