import { describe, expect, it } from "vitest";
import { chunkArray, sleep } from "../src/chunking.ts";

describe("chunkArray", () => {
  it("splits an array into chunks of the requested size", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one chunk when size exceeds length", () => {
    expect(chunkArray([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("returns empty array for empty input", () => {
    expect(chunkArray<number>([], 3)).toEqual([]);
  });
});

describe("sleep", () => {
  it("resolves after at least the given milliseconds", async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
