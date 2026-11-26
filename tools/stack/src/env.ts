import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Read deploy/local/.env without adding a dotenv dependency. */
export function loadLocalEnv(): Record<string, string> {
  const file = join(import.meta.dirname, "../../../deploy/local/.env");
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m?.[1]) env[m[1]] = m[2] ?? "";
  }
  return env;
}

export const FORGEJO_URL = process.env.FORGEJO_URL ?? "http://localhost:3000";
export const ORG = "adconversion";
