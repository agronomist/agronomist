import { describe, expect, it } from "vitest";
import { getJson } from "../src/data/http";

describe("getJson timeout", () => {
  it("gives up on a request that never answers", async () => {
    const hang = () => new Promise<never>(() => {});
    await expect(getJson("http://x", { fetch: hang, retries: 0, timeoutMs: 30 })).rejects.toThrow(/no answer/);
  });
});
