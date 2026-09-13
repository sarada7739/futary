import { describe, expect, it } from "vitest";
import { chunk } from "../lib/chunk";

describe("chunk", () => {
  it("size ずつに分ける。端数は最後に。空なら空", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 2)).toEqual([[1, 2]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it("101 個を 100 ずつに分けると 100 + 1", () => {
    const items = Array.from({ length: 101 }, (_, i) => i);
    const chunks = chunk(items, 100);
    expect(chunks.map((c) => c.length)).toEqual([100, 1]);
    expect(chunks.flat()).toEqual(items);
  });
});
