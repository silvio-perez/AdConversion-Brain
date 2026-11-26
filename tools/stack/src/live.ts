// Helpers for live-stack tests (stack seeded + `pnpm gateway` running).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";

export const GATEWAY = process.env.BRAIN_URL ?? "http://localhost:8787";

export function gatewayEnv(): Record<string, string> {
  const file = join(import.meta.dirname, "../../../deploy/local/gateway.env");
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1], m[2]]),
  );
}

export function brainCli(...args: string[]): { ok: boolean; out: string } {
  try {
    return {
      ok: true,
      out: execFileSync("pnpm", ["-s", "brain", ...args], { encoding: "utf8", stdio: "pipe" }),
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

export function createToken(
  owner: string,
  harness: string,
  sources: string,
  mode = "read",
): string {
  const res = brainCli(
    "token",
    "create",
    "--owner",
    owner,
    "--harness",
    harness,
    "--sources",
    sources,
    "--mode",
    mode,
    "--days",
    "1",
  );
  expect(res.ok, res.out).toBe(true);
  const token = res.out.split("\n").find((l) => l.startsWith("brn_"));
  if (!token) throw new Error(res.out);
  return token;
}

let id = 0;
export async function mcpCall(token: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(`${GATEWAY}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  const text = body.result.content.map((c) => c.text).join("\n");
  return {
    text,
    isError: !!body.result.isError,
    json: () => JSON.parse(text) as Record<string, unknown>,
  };
}
