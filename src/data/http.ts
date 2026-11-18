/** Minimal fetch shape so the adapters run in browsers, Node, and tests without DOM typings. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type FetchLike = (url: string) => Promise<FetchResponseLike>;

export interface HttpOptions {
  fetch?: FetchLike;
  /** Retries after the first attempt for 429/5xx/network errors. Default 3. */
  retries?: number;
  /** Injectable sleep (ms) so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET JSON with exponential backoff on 429, 5xx and network errors. 4xx other than 429 fail fast. */
export async function getJson(url: string, o: HttpOptions = {}): Promise<unknown> {
  const f: FetchLike =
    o.fetch ?? ((globalThis as unknown as { fetch: FetchLike }).fetch.bind(globalThis) as FetchLike);
  const sleep = o.sleep ?? defaultSleep;
  const retries = o.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await f(url);
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new HttpError(`HTTP ${res.status}`, res.status);
      lastErr = new HttpError(`HTTP ${res.status}`, res.status);
    } catch (e) {
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      lastErr = e;
    }
    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
