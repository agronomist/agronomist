
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
