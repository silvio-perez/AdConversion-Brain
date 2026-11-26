// Shared test setup: a full gateway over the synthetic fixtures, in memory.
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Brain } from "./brain.ts";
import { FixtureSource } from "./content.ts";
import { createApp } from "./http.ts";
import { syncIndex } from "./indexer.ts";
import { loadVendorPolicy } from "./policy.ts";
import { MemoryWriter } from "./proposals.ts";
import { openStore } from "./store.ts";
import { createToken, type NewToken } from "./tokens.ts";

export const ROOT = join(import.meta.dirname, "../../..");
export const CANARY = "GLOBEX-CANARY-7f3a";
export const ACME = "client-acme-analytics";
export const GLOBEX = "client-globex-cloud";

export async function makeGateway() {
  const db = openStore(":memory:");
  await syncIndex(db, new FixtureSource(join(ROOT, "fixtures/synthetic")));
  // In-memory stand-in for Forgejo, seeded with the same revisions as the index.
  const writer = new MemoryWriter();
  for (const d of db.prepare("SELECT source, path, revision, body FROM documents").all() as {
    source: string;
    path: string;
    revision: string;
    body: string;
  }[])
    writer.files.set(`${d.source}/${d.path}`, { revision: d.revision, content: d.body });
  const brain = new Brain(db, loadVendorPolicy(join(ROOT, "config/vendor-policy.json")), writer);
  const app = createApp({ db, brain, clientKey: (c) => c.req.header("x-test-client") ?? "test" });

  const token = (over: Partial<NewToken> = {}) =>
    createToken(db, {
      name: "test",
      owner: "alice.synthetic",
      harness: "claude-code",
      vendor: "anthropic",
      sources: ["company", "skills", ACME],
      days: 30,
      ...over,
    }).token;

  const get = async (path: string, tok?: string) => {
    const res = await app.request(path, tok ? { headers: { authorization: `Bearer ${tok}` } } : {});
    const text = await res.text();
    return { status: res.status, text, json: text ? (JSON.parse(text) as unknown) : null };
  };

  const mcp = async (tok: string) => {
    const client = new Client({ name: "test-harness", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://brain.test/mcp"), {
        requestInit: { headers: { authorization: `Bearer ${tok}` } },
        fetch: async (input, init) => app.request(String(input), init),
      }),
    );
    return client;
  };

  return { db, brain, app, token, get, mcp, writer };
}

/** Concatenate all text content from an MCP tool result. */
export const toolText = (r: unknown): string =>
  ((r as { content?: { type: string; text?: string }[] }).content ?? [])
    .map((c) => c.text ?? "")
    .join("\n");
