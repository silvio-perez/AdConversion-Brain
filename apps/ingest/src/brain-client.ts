// Minimal REST client for the Brain Gateway. Ingestion has no special access:
// it uses an ordinary propose-mode token like any other agent.
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class BrainError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(`Brain API ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export class BrainClient {
  readonly #url: string;
  readonly #token: string;
  readonly #fetch: FetchLike;
  constructor(opts: { url: string; token: string; fetch?: FetchLike }) {
    this.#url = opts.url.replace(/\/$/, "");
    this.#token = opts.token;
    this.#fetch = opts.fetch ?? ((u, i) => fetch(u, i));
  }

  async #call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.#fetch(`${this.#url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) throw new BrainError(res.status, json);
    return json as T;
  }

  whoami() {
    return this.#call<{ owner: string; vendor: string; mode: string; sources: string[] }>(
      "GET",
      "/v1/whoami",
    );
  }
  async readBody(source: string, path: string): Promise<string | null> {
    try {
      return (await this.#call<{ body: string }>("GET", `/v1/sources/${source}/documents/${path}`))
        .body;
    } catch (err) {
      if (err instanceof BrainError && err.status === 404) return null;
      throw err;
    }
  }
  async search(source: string, q: string, limit = 3) {
    const params = new URLSearchParams({ q, source, limit: String(limit) });
    return (
      await this.#call<{ results: { path: string; title: string | null }[] }>(
        "GET",
        `/v1/search?${params}`,
      )
    ).results;
  }
  async proposals(source: string) {
    return (
      await this.#call<{ proposals: { path: string; state: string; url: string }[] }>(
        "GET",
        `/v1/proposals?source=${encodeURIComponent(source)}`,
      )
    ).proposals;
  }
  propose(
    source: string,
    body: { path: string; content: string; summary: string; evidence: unknown[] },
  ) {
    return this.#call<{ proposalId: string; reviewUrl: string }>(
      "POST",
      `/v1/sources/${source}/proposals`,
      body,
    );
  }
}
