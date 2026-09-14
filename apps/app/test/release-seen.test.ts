import { beforeEach, describe, expect, it } from "vitest";
import {
  deferRelease,
  hasUnseenRelease,
  isReleaseDeferred,
  markReleaseSeen,
  RELEASE_LATER_STORAGE_KEY,
  RELEASE_SEEN_STORAGE_KEY,
} from "../lib/release-seen";
import { LATEST_VERSION } from "../lib/releases";

// 043: 「見た」の持ち方（タスク定義 2節）の単体テスト。ストレージは test/setup.ts の in-memory Storage

function withThrowingStorage(name: "localStorage" | "sessionStorage", run: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      throw new Error("SecurityError: storage is disabled");
    },
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, name, original);
  }
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("hasUnseenRelease / markReleaseSeen", () => {
  it("何も保存していなければ未読", () => {
    expect(hasUnseenRelease()).toBe(true);
  });

  it("markReleaseSeen で最新の版が保存され、既読になる", () => {
    markReleaseSeen();
    expect(window.localStorage.getItem(RELEASE_SEEN_STORAGE_KEY)).toBe(LATEST_VERSION);
    expect(hasUnseenRelease()).toBe(false);
  });

  it("旧い版を見た端末では未読（文字列の一致だけ。大小は比べない）", () => {
    window.localStorage.setItem(RELEASE_SEEN_STORAGE_KEY, "0.9.0");
    expect(hasUnseenRelease()).toBe(true);
    window.localStorage.setItem(RELEASE_SEEN_STORAGE_KEY, "99.0.0");
    expect(hasUnseenRelease()).toBe(true);
  });

  it("localStorage が例外を投げる環境では既読扱い（バッジもシートも出さない。0節 #9）", () => {
    withThrowingStorage("localStorage", () => {
      expect(hasUnseenRelease()).toBe(false);
      // 書き込みも例外にならない
      expect(() => markReleaseSeen()).not.toThrow();
    });
  });
});

describe("deferRelease / isReleaseDeferred（同じ起動の中だけ）", () => {
  it("押していなければ false。押すと sessionStorage に最新の版が入り true", () => {
    expect(isReleaseDeferred()).toBe(false);
    deferRelease();
    expect(window.sessionStorage.getItem(RELEASE_LATER_STORAGE_KEY)).toBe(LATEST_VERSION);
    expect(isReleaseDeferred()).toBe(true);
  });

  it("「後で」は見たことにしない（localStorage には何も入らない）", () => {
    deferRelease();
    expect(window.localStorage.getItem(RELEASE_SEEN_STORAGE_KEY)).toBeNull();
    expect(hasUnseenRelease()).toBe(true);
  });

  it("旧い版で「後で」を押した記録は、新しい版には効かない", () => {
    window.sessionStorage.setItem(RELEASE_LATER_STORAGE_KEY, "0.9.0");
    expect(isReleaseDeferred()).toBe(false);
  });

  it("sessionStorage が例外を投げる環境では「後で」は効かない（false）", () => {
    withThrowingStorage("sessionStorage", () => {
      expect(isReleaseDeferred()).toBe(false);
      expect(() => deferRelease()).not.toThrow();
    });
  });
});
