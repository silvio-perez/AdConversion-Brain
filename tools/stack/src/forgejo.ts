import { FORGEJO_URL } from "./env.ts";

export interface Credentials {
  username: string;
  password: string;
}

export const basicAuth = ({ username, password }: Credentials): string =>
  `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

/** Minimal Forgejo API client. Credentials go in headers, never in URLs (SEC-AUTH-5). */
export function forgejo(creds: Credentials | null) {
  return async function api(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (creds) headers.authorization = basicAuth(creds);
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${FORGEJO_URL}/api/v1${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  };
}
