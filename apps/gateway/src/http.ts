// HTTP front door: authentication, MCP endpoint, REST API and OpenAPI spec.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { Brain, type Caller, NotFoundError } from "./brain.ts";
import { buildMcpServer } from "./mcp.ts";
import { openApiSpec } from "./openapi.ts";
import type { Store } from "./store.ts";
import { verifyToken } from "./tokens.ts";

type Env = { Variables: { caller: Caller } };

/** Very small in-memory limiter for failed authentication (SEC-AUTH-6). */
export function failedAuthLimiter(maxPerMinute = 20) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    blocked(key: string, now = Date.now()) {
      const h = hits.get(key);
      return !!h && h.resetAt > now && h.count >= maxPerMinute;
    },
    fail(key: string, now = Date.now()) {
      const h = hits.get(key);
      if (!h || h.resetAt <= now) hits.set(key, { count: 1, resetAt: now + 60_000 });
      else h.count += 1;
    },
  };
}

export function createApp(opts: { db: Store; brain: Brain; clientKey?: (c: Context) => string }) {
  const { db, brain } = opts;
  const limiter = failedAuthLimiter();
  const clientKey =
    opts.clientKey ??
    ((c: Context) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local");
  const app = new Hono<Env>();

  app.use("*", bodyLimit({ maxSize: 256 * 1024 }));
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/v1/openapi.json", (c) => c.json(openApiSpec));

  // Authentication for everything below. Tokens are accepted ONLY in the
  // Authorization header: URLs end up in logs and browser history (SEC-AUTH-5).
  const authenticate = async (c: Context<Env>, next: () => Promise<void>) => {
    const url = new URL(c.req.url);
    for (const p of ["token", "key", "access_token", "api_key"])
      if (url.searchParams.has(p)) {
        brain.audit(null, "auth", "rejected_token_in_url");
        return c.json(
          { error: "Send the token in the Authorization header, never in the URL." },
          400,
        );
      }
    const key = clientKey(c);
    if (limiter.blocked(key))
      return c.json({ error: "Too many failed attempts. Try again later." }, 429);
    const header = c.req.header("authorization") ?? "";
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    const record = m?.[1] ? verifyToken(db, m[1]) : null;
    if (!record) {
      limiter.fail(key);
      brain.audit(null, "auth", m ? "invalid_token" : "missing_token");
      return c.json({ error: "Unauthorized" }, 401, {
        "www-authenticate": 'Bearer realm="adconversion-brain"',
      });
    }
    c.set("caller", Brain.newCaller(record, url.pathname === "/mcp" ? "mcp" : "rest"));
    await next();
  };
  app.use("/mcp", authenticate);
  app.use("/v1/*", authenticate);

  app.all("/mcp", async (c) => {
    // No sessionIdGenerator = stateless: every request is authenticated on its own.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await buildMcpServer(brain, c.get("caller")).connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  const rest = (fn: (c: Context<Env>, caller: Caller) => unknown) => async (c: Context<Env>) => {
    try {
      return c.json(fn(c, c.get("caller")) as object);
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: "Not found" }, 404);
      throw err;
    }
  };

  app.get(
    "/v1/whoami",
    rest((_c, caller) => brain.whoami(caller)),
  );
  app.get(
    "/v1/sources",
    rest((_c, caller) => ({ sources: brain.listSources(caller) })),
  );
  app.get(
    "/v1/sources/:source/documents",
    rest((c, caller) => ({
      documents: brain.listDocuments(
        caller,
        c.req.param("source") ?? "",
        c.req.query("prefix") ?? "",
      ),
    })),
  );
  app.get(
    "/v1/sources/:source/documents/*",
    rest((c, caller) => {
      const source = c.req.param("source") ?? "";
      const marker = `/v1/sources/${encodeURIComponent(source)}/documents/`;
      const path = decodeURIComponent(new URL(c.req.url).pathname.slice(marker.length));
      return brain.readDocument(caller, source, path);
    }),
  );
  app.get(
    "/v1/search",
    rest((c, caller) => {
      const limit = Number(c.req.query("limit") ?? 10);
      const source = c.req.query("source");
      return {
        results: brain.search(caller, c.req.query("q") ?? "", {
          ...(source ? { source } : {}),
          ...(Number.isFinite(limit) ? { limit } : {}),
        }),
      };
    }),
  );

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Internal error" }, 500);
  });
  return app;
}
