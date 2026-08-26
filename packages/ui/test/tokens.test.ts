import { describe, expect, it } from "vitest";
import { colors, radius, space } from "../src/tokens";

describe("tokens", () => {
  it("色トークンが生の16進カラーとして定義されている", () => {
    expect(colors.bg).toBe("#FEF6F3");
    expect(colors.primary).toBe("#F5868D");
    expect(colors.primaryPressed).toBe("#E4707A");
  });

  it("角丸トークンがarchitecture.mdの値と一致する", () => {
    expect(radius.card).toBe(20);
    expect(radius.input).toBe(14);
    expect(radius.pill).toBe(999);
  });

  it("余白トークンが4の倍数で単調増加する", () => {
    const values = Object.values(space);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
      expect(values[i]! % 4).toBe(0);
    }
  });
});
