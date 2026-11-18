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
  /** Give up on one attempt after this many ms (a hung server otherwise waits forever). Default 25000. */
  timeoutMs?: number;
  /** After a 429 (rate limit), wait this long, doubling each time up to 60 s, instead of the short default. Default 0 (off). */
  rateLimitWaitMs?: number;
  /** Called with the wait (ms) before each retry after a 429, so a screen can say it is waiting rather than look stuck. */
  onWait?: (ms: number) => void;
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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timer = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`no answer after ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET JSON with exponential backoff on 429, 5xx and network errors. 4xx other than 429 fail fast. */
export async function getJson(url: string, o: HttpOptions = {}): Promise<unknown> {
  const f: FetchLike =
    o.fetch ?? ((globalThis as unknown as { fetch: FetchLike }).fetch.bind(globalThis) as FetchLike);
  const sleep = o.sleep ?? defaultSleep;
  const wait = o.rateLimitWaitMs ?? 0;
  const retries = wait > 0 ? Math.max(o.retries ?? 3, 5) : (o.retries ?? 3);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await withTimeout(f(url), o.timeoutMs ?? 25000);
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new HttpError(`HTTP ${res.status}`, res.status);
      lastErr = new HttpError(`HTTP ${res.status}`, res.status);
    } catch (e) {
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      lastErr = e;
    }
    const limited = lastErr instanceof HttpError && lastErr.status === 429 && wait > 0;
    if (attempt < retries) {
      const ms = limited ? Math.min(60000, wait * 2 ** attempt) : 500 * 2 ** attempt;
      if (limited) o.onWait?.(ms);
      await sleep(ms);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
