import { describe, expect, it } from "vitest";
import { lockNotice, lockNoticeShort } from "../lib/plan";

// 047: 猶予・鍵の帯の文言（判定はサーバの planState。画面は表示だけ）
// 2026-10-16 00:00 JST = 2026-10-15T15:00:00Z
const LOCK_AT = Date.UTC(2026, 9, 15, 15, 0, 0) / 1000;
const QUOTA = { limit: 30, used: 100 };

describe("lockNotice（047）", () => {
  it("猶予中: 日付（JST の暦日）+「までに写真を保存してください。それ以降、無料枠を超える写真は見られなくなります」", () => {
    expect(lockNotice({ plan: "free", lockAt: LOCK_AT, locked: false }, QUOTA)).toEqual({
      kind: "grace",
      text: "2026年10月16日までに写真を保存してください。それ以降、無料枠を超える写真は見られなくなります",
    });
  });

  it("鍵の後: 「無料枠を超える 70 枚は見られません」（used - limit）", () => {
    expect(lockNotice({ plan: "free", lockAt: LOCK_AT, locked: true }, QUOTA)).toEqual({
      kind: "locked",
      text: "無料枠を超える 70 枚は見られません",
    });
  });

  it("出さない: paid・lockAt null（一度も paid になっていない）・無料枠を超えていない・枠が無い・届いていない", () => {
    expect(lockNotice({ plan: "paid" }, QUOTA)).toBeNull();
    expect(lockNotice({ plan: "free", lockAt: null, locked: false }, QUOTA)).toBeNull();
    expect(lockNotice({ plan: "free", lockAt: LOCK_AT, locked: true }, { limit: 30, used: 30 })).toBeNull();
    expect(lockNotice({ plan: "free", lockAt: LOCK_AT, locked: false }, null)).toBeNull();
    expect(lockNotice(undefined, QUOTA)).toBeNull();
  });

  it("詳細の短い形: 猶予中は「それ以降、」を落とす。鍵の後はそのまま", () => {
    expect(lockNoticeShort({ kind: "grace", text: "2026年10月16日までに写真を保存してください。それ以降、無料枠を超える写真は見られなくなります" })).toBe(
      "2026年10月16日までに写真を保存してください。無料枠を超える写真は見られなくなります",
    );
    expect(lockNoticeShort({ kind: "locked", text: "無料枠を超える 70 枚は見られません" })).toBe("無料枠を超える 70 枚は見られません");
  });
});
