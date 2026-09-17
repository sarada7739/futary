import { describe, expect, it } from "vitest";
import {
  MAX_STRETCH,
  clamp,
  maxPillX,
  nearestAllowedIndex,
  nearestTabIndex,
  pillRestX,
  stretchForVelocity,
} from "../lib/tab-pill";

// 061: ピルの位置の計算（lib/tab-pill.ts）。描画からは切り離してあるため、
// 実機や jsdom のレイアウトに依存せずに検査できる。
// 以降の数値は「幅 360 のバーに 5 スロット（1スロット 72）・余白 5」を前提にする

const SLOT = 72;
const INSET = 5;
const COUNT = 5;

describe("P1: ピルが休む位置", () => {
  it("index 番目のスロットの左端に余白を足した位置になる", () => {
    expect(pillRestX(0, SLOT, INSET)).toBe(5);
    expect(pillRestX(1, SLOT, INSET)).toBe(77);
    expect(pillRestX(4, SLOT, INSET)).toBe(293);
  });
});

describe("P2: ドラッグできる右端", () => {
  it("最後のスロットの休む位置と一致する（バーの外へ出さない）", () => {
    expect(maxPillX(360, SLOT, INSET)).toBe(pillRestX(COUNT - 1, SLOT, INSET));
  });

  it("スロットがバーより広くても、余白を下回らない", () => {
    expect(maxPillX(50, SLOT, INSET)).toBe(INSET);
  });
});

describe("P3: 指を離したときに寄せる先", () => {
  it("止まったまま離すと、今いるスロットに留まる", () => {
    expect(nearestTabIndex(pillRestX(2, SLOT, INSET), 0, SLOT, INSET, COUNT)).toBe(2);
  });

  it("スロットの半分を超えて動いていれば、隣へ移る", () => {
    expect(nearestTabIndex(pillRestX(2, SLOT, INSET) + SLOT * 0.6, 0, SLOT, INSET, COUNT)).toBe(3);
  });

  it("半分に届いていなければ、元のスロットへ戻る", () => {
    expect(nearestTabIndex(pillRestX(2, SLOT, INSET) + SLOT * 0.4, 0, SLOT, INSET, COUNT)).toBe(2);
  });

  // 位置だけで決めると、勢いよく振っても隣までしか動かない（lib のコメント）
  it("速く振ると、位置だけで決めるより先のスロットへ飛ぶ", () => {
    const x = pillRestX(1, SLOT, INSET);
    expect(nearestTabIndex(x, 0, SLOT, INSET, COUNT)).toBe(1);
    expect(nearestTabIndex(x, 4, SLOT, INSET, COUNT)).toBeGreaterThan(1);
  });

  it("左右どちらへ振っても、端のスロットを越えない", () => {
    expect(nearestTabIndex(pillRestX(4, SLOT, INSET), 20, SLOT, INSET, COUNT)).toBe(COUNT - 1);
    expect(nearestTabIndex(pillRestX(0, SLOT, INSET), -20, SLOT, INSET, COUNT)).toBe(0);
  });

  // 幅が測れる前（onLayout の前）に離された場合。0 除算で NaN を返さない
  it("スロット幅が 0 でも NaN にならない", () => {
    expect(nearestTabIndex(0, 1, 0, INSET, COUNT)).toBe(0);
    expect(nearestTabIndex(0, 1, SLOT, INSET, 0)).toBe(0);
  });
});

describe("P4: 速さによる横の伸び", () => {
  it("止まっていれば伸びない", () => {
    expect(stretchForVelocity(0)).toBe(1);
  });

  it("速いほど伸びるが、上限を超えない", () => {
    expect(stretchForVelocity(0.4)).toBeGreaterThan(1);
    expect(stretchForVelocity(100)).toBe(1 + MAX_STRETCH);
  });

  it("左へ振っても右へ振っても同じだけ伸びる", () => {
    expect(stretchForVelocity(-0.8)).toBe(stretchForVelocity(0.8));
  });
});

describe("P5: clamp", () => {
  it("範囲の内・下・上で期待どおりに丸める", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

// ＋投稿（FAB）はスロット 2 を占めるが、選ばれた状態にならない。
// ここへ寄せると、選択は変わらないのにピルだけが取り残される
describe("P6: ピルが乗ってよいスロットへ寄せ直す", () => {
  const ALLOWED = [0, 1, 3, 4];

  it("＋投稿のスロットを指すと、隣の本物のタブへ振り替える", () => {
    expect(ALLOWED).not.toContain(2);
    expect(nearestAllowedIndex(2, ALLOWED)).toBe(1);
  });

  it("もともと本物のタブならそのまま", () => {
    for (const index of ALLOWED) {
      expect(nearestAllowedIndex(index, ALLOWED)).toBe(index);
    }
  });

  it("寄せ先が1つも無ければ、そのまま返す（落ちない）", () => {
    expect(nearestAllowedIndex(2, [])).toBe(2);
  });
});
