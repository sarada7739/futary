import { describe, expect, it } from "vitest";
import {
  MAX_TILT_X,
  MAX_TILT_Y,
  RETURN_SECONDS,
  TILT_PER_PIXEL,
  decayTilt,
  isAtRest,
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

  it("上下限（x ±0.5・y ±0.7）で止まる", () => {
    expect(MAX_TILT_X).toBe(0.5);
    expect(MAX_TILT_Y).toBe(0.7);
    expect(tiltFromDrag({ x: 0, y: 0 }, 10_000, 10_000)).toEqual({ x: MAX_TILT_X, y: MAX_TILT_Y });
    expect(tiltFromDrag({ x: 0, y: 0 }, -10_000, -10_000)).toEqual({ x: -MAX_TILT_X, y: -MAX_TILT_Y });
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
