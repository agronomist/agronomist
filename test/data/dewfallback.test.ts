import { describe, expect, it } from "vitest";
import { fetchHistory } from "../../src";
import { openMeteoResponse } from "./fixtures";

describe("dew point request fallback", () => {
  it("repeats the request without dew point when the archive refuses it, and stops asking", async () => {
    const calls: string[] = [];
    const fetch = (async (url: string) => {
      calls.push(String(url));
      const refuse = String(url).includes("dew_point_2m_mean");
      return { ok: !refuse, status: refuse ? 400 : 200, json: async () => openMeteoResponse({ days: 30 }), text: async () => "" } as unknown as Response;
    }) as typeof globalThis.fetch;
    const now = new Date("2020-06-20T00:00:00Z");
    await fetchHistory(42, -93.6, { fetch, now, retries: 0, firstYear: 2020 });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("dew_point_2m_mean");
    expect(calls[1]).not.toContain("dew_point_2m_mean");
    await fetchHistory(42, -93.6, { fetch, now, retries: 0, firstYear: 2020 });
    expect(calls).toHaveLength(3); // the second record goes straight to the plain request
    expect(calls[2]).not.toContain("dew_point_2m_mean");
  });
});
