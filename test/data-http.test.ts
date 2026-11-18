import { describe, expect, it } from "vitest";
import { getJson } from "../src/data/http";

describe("getJson timeout", () => {
  it("gives up on a request that never answers", async () => {
    const hang = () => new Promise<never>(() => {});
    await expect(getJson("http://x", { fetch: hang, retries: 0, timeoutMs: 30 })).rejects.toThrow(/no answer/);
  });
});

describe("rate limit wait", () => {
  it("waits long after a 429 when asked to, and gives up its short default otherwise", async () => {
    let calls = 0;
    const waits: number[] = [];
    const fetch = async () => (++calls < 3 ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ ok: 1 }) });
    const out = await getJson("x", { fetch, sleep: async (ms) => void waits.push(ms), rateLimitWaitMs: 8000 });
    expect(out).toEqual({ ok: 1 });
    expect(waits).toEqual([8000, 16000]);
  });
});

describe("onWait", () => {
  it("reports each wait after a 429 so the screen can say it is waiting", async () => {
    let n = 0;
    const fetch = (async () => {
      n++;
      return n < 3 ? ({ ok: false, status: 429, json: async () => ({}) } as unknown as Response) : ({ ok: true, status: 200, json: async () => ({ ok: 1 }) } as unknown as Response);
    }) as typeof globalThis.fetch;
    const waits: number[] = [];
    const r = await getJson("http://x", { fetch, rateLimitWaitMs: 1000, sleep: async () => {}, onWait: (ms) => waits.push(ms) });
    expect(r).toEqual({ ok: 1 });
    expect(waits).toEqual([1000, 2000]);
  });
});
