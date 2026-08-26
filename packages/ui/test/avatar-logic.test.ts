import { describe, expect, it } from "vitest";
import { initialOf } from "../src/components/avatar-logic";

describe("initialOf", () => {
  it("先頭の1文字を大文字にして返す", () => {
    expect(initialOf("haruka")).toBe("H");
    expect(initialOf("Yuki")).toBe("Y");
  });

  it("前後の空白を無視する", () => {
    expect(initialOf("  haruka  ")).toBe("H");
  });

  it("空文字・空白のみの場合は ? を返す", () => {
    expect(initialOf("")).toBe("?");
    expect(initialOf("   ")).toBe("?");
  });

  it("日本語の先頭文字も1文字として取り出す", () => {
    expect(initialOf("はるか")).toBe("は");
  });
});
