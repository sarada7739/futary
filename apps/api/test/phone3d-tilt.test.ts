import { describe, expect, it } from "vitest";
import {
  ENTRY_TILT,
  FRONT,
  MAX_TILT_X,
  MAX_TILT_Y,
  RETURN_SECONDS,
  SNAP_REMAINING,
  TILT_PER_PIXEL,
  angleForScroll,
  decayTilt,
  easeInCubic,
  isAtRest,
  scrollProgress,
  tiltFromDrag,
} from "../../landing/js/tilt.mjs";

// LP の 3D のスマホの傾き（068 T2）。apps/landing/js/tilt.mjs は DOM・three.js に触らない純粋な関数
describe("068 T2: tiltFromDrag", () => {
  it("右へ引くと y、下へ引くと x が、1px あたり TILT_PER_PIXEL ずつ増える", () => {
    expect(tiltFromDrag({ x: 0, y: 0 }, 10, 0)).toEqual({ x: 0, y: 10 * TILT_PER_PIXEL });
    expect(tiltFromDrag({ x: 0, y: 0 }, 0, -20)).toEqual({ x: -20 * TILT_PER_PIXEL, y: 0 });
  });

  it("押した時点の傾きに足す", () => {
    const tilt = tiltFromDrag({ x: 0.1, y: -0.2 }, 10, 10);
    expect(tilt.x).toBeCloseTo(0.1 + 10 * TILT_PER_PIXEL);
    expect(tilt.y).toBeCloseTo(-0.2 + 10 * TILT_PER_PIXEL);
  });

  it("上下限（x ±0.5・y ±1.4 = 約 80°。裏面は見せない）で止まる", () => {
    expect(MAX_TILT_X).toBe(0.5);
    expect(MAX_TILT_Y).toBe(1.4);
    expect(MAX_TILT_Y).toBeLessThan(Math.PI / 2);
    expect(tiltFromDrag({ x: 0, y: 0 }, 10_000, 10_000)).toEqual({ x: MAX_TILT_X, y: MAX_TILT_Y });
    expect(tiltFromDrag({ x: 0, y: 0 }, -10_000, -10_000)).toEqual({ x: -MAX_TILT_X, y: -MAX_TILT_Y });
  });
});

describe("068 T2: タッチ（yOnly）は横のスワイプだけ傾ける", () => {
  it("縦の動きでは x が押した時点のまま（縦はページのスクロールに任せる）", () => {
    expect(tiltFromDrag({ x: 0, y: 0 }, 0, 200, { yOnly: true })).toEqual({ x: 0, y: 0 });
    expect(tiltFromDrag({ x: 0.1, y: 0 }, 50, -300, { yOnly: true })).toEqual({ x: 0.1, y: 50 * TILT_PER_PIXEL });
    expect(tiltFromDrag({ x: 0, y: 0 }, 10_000, 0, { yOnly: true })).toEqual({ x: 0, y: MAX_TILT_Y });
  });
});

describe("068 T2: decayTilt（離したあと正面へ戻る）", () => {
  it("時間がたつほど 0 に近づき、符号は変わらない", () => {
    const start = { x: 0.4, y: -0.6 };
    const a = decayTilt(start, 0.1);
    const b = decayTilt(start, 0.3);
    expect(Math.abs(a.x)).toBeLessThan(0.4);
    expect(Math.abs(b.x)).toBeLessThan(Math.abs(a.x));
    expect(a.x).toBeGreaterThan(0);
    expect(a.y).toBeLessThan(0);
  });

  it("RETURN_SECONDS（約 0.6 秒）で 1% まで減る。小さくなったら 0 で止まる", () => {
    expect(RETURN_SECONDS).toBeCloseTo(0.6);
    const after = decayTilt({ x: MAX_TILT_X, y: MAX_TILT_Y }, RETURN_SECONDS);
    expect(after.x).toBeCloseTo(MAX_TILT_X * 0.01, 6);
    expect(after.y).toBeCloseTo(MAX_TILT_Y * 0.01, 6);
    const rest = decayTilt({ x: MAX_TILT_X, y: MAX_TILT_Y }, RETURN_SECONDS * 2);
    expect(rest).toEqual({ x: 0, y: 0 });
    expect(isAtRest(rest)).toBe(true);
  });

  it("小刻みに進めても、まとめて進めても同じ（フレームの間隔に依らない）", () => {
    let stepped = { x: 0.3, y: 0.3 };
    for (let i = 0; i < 10; i++) stepped = decayTilt(stepped, 0.016);
    const once = decayTilt({ x: 0.3, y: 0.3 }, 0.16);
    expect(stepped.x).toBeCloseTo(once.x, 9);
    expect(stepped.y).toBeCloseTo(once.y, 9);
  });

  it("dt が 0 や負なら動かない", () => {
    expect(decayTilt({ x: 0.2, y: 0.1 }, 0)).toEqual({ x: 0.2, y: 0.1 });
    expect(decayTilt({ x: 0.2, y: 0.1 }, -1)).toEqual({ x: 0.2, y: 0.1 });
    expect(isAtRest({ x: 0.2, y: 0 })).toBe(false);
  });
});

// スクロールで斜めから正面へ（068 追補 3）
describe("068 追補 3: scrollProgress（ステージの位置 → 進み具合）", () => {
  const vh = 900;
  const h = 791;
  it("上端がビューポートの下端で 0、中心がビューポートの中心で 1", () => {
    expect(scrollProgress(vh, h, vh)).toBe(0);
    expect(scrollProgress(vh / 2 - h / 2, h, vh)).toBe(1);
  });

  it("まだ入っていなければ 0、中心を過ぎたら 1 のまま", () => {
    expect(scrollProgress(vh + 300, h, vh)).toBe(0);
    expect(scrollProgress(-2000, h, vh)).toBe(1);
  });

  it("間は位置に比例する（上へ動くほど大きい）", () => {
    const a = scrollProgress(800, h, vh);
    const b = scrollProgress(400, h, vh);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(1);
  });
});

describe("068 追補 3: angleForScroll（進み具合 → 角度）", () => {
  it("0 で始めの角度（y は約 25°・x は約 8°）、1 以上で正面", () => {
    expect(angleForScroll(0)).toEqual(ENTRY_TILT);
    expect(Math.abs(ENTRY_TILT.y)).toBeCloseTo(0.44);
    expect(Math.abs(ENTRY_TILT.x)).toBeCloseTo(0.14);
    expect(angleForScroll(1)).toEqual(FRONT);
    expect(angleForScroll(1.5)).toEqual(FRONT);
    expect(angleForScroll(-1)).toEqual(ENTRY_TILT);
  });

  it("途中は単調に正面へ近づく（easeInCubic）", () => {
    let previous = Infinity;
    for (let p = 0; p <= 1.0001; p += 0.1) {
      const size = Math.abs(angleForScroll(p).y);
      expect(size).toBeLessThanOrEqual(previous);
      previous = size;
    }
    expect(Math.abs(angleForScroll(0.5).y)).toBeCloseTo(Math.abs(ENTRY_TILT.y) * (1 - easeInCubic(0.5)));
    expect(easeInCubic(0.5)).toBeCloseTo(0.125);
  });

  it("1280×900 の LP（ステージ 791px）: 上端 600px で約 24°・全部見えて約 4.5°・中心で正面", () => {
    const degrees = (top: number) => (Math.abs(angleForScroll(scrollProgress(top, 791, 900)).y) * 180) / Math.PI;
    expect(degrees(600)).toBeCloseTo(24.1, 0);
    expect(degrees(900 - 791)).toBeCloseTo(4.5, 0);
    expect(angleForScroll(scrollProgress(900 / 2 - 791 / 2, 791, 900))).toEqual(FRONT);
    // 画素に丸めた中心（55px）でも正面ちょうど
    expect(angleForScroll(scrollProgress(55, 791, 900))).toEqual(FRONT);
  });

  it("正面のすぐ手前（残りが SNAP_REMAINING 未満）は正面ちょうど（2D の変形で描けて文字がにじまない）", () => {
    // 1 - p^3 < SNAP_REMAINING になる p の手前と先
    const edge = Math.cbrt(1 - SNAP_REMAINING);
    expect(angleForScroll(edge + 0.001)).toEqual(FRONT);
    expect(angleForScroll(edge - 0.01)).not.toEqual(FRONT);
  });
});

describe("068 追補 3: decayTilt・isAtRest の向かう先", () => {
  it("target へ戻り、着いたら target ちょうど", () => {
    const target = { x: -0.05, y: 0.2 };
    const half = decayTilt({ x: 0.4, y: -0.6 }, 0.1, target);
    expect(half.x).toBeLessThan(0.4);
    expect(half.x).toBeGreaterThan(target.x);
    const done = decayTilt({ x: 0.4, y: -0.6 }, RETURN_SECONDS * 3, target);
    expect(done).toEqual(target);
    expect(isAtRest(done, target)).toBe(true);
    expect(isAtRest(done)).toBe(false);
  });
});
