import { beforeEach, describe, expect, it } from "vitest";
import {
  dismissQuotaWarning,
  isQuotaWarningDismissed,
  QUOTA_WARNING_DISMISSED_STORAGE_KEY,
} from "../lib/quota-warning-dismissed";

// 045（人間の指示）: 「残り N 枚です」の警告は × で消せる。消した状態はこの起動の間（sessionStorage）。
// 残り枚数が変われば（写真を足したら）もう一度出す
describe("quota-warning-dismissed", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("消していなければ false", () => {
    expect(isQuotaWarningDismissed(4)).toBe(false);
  });

  it("消したときの残り枚数と一致するときだけ true。残りが変わればまた出す", () => {
    dismissQuotaWarning(4);
    expect(window.sessionStorage.getItem(QUOTA_WARNING_DISMISSED_STORAGE_KEY)).toBe("4");
    expect(isQuotaWarningDismissed(4)).toBe(true);
    expect(isQuotaWarningDismissed(3)).toBe(false);
    expect(isQuotaWarningDismissed(5)).toBe(false);
  });

  it("残り 0 でも消せる（FAB を押せばシートが出るので、警告が無くても上限は伝わる）", () => {
    dismissQuotaWarning(0);
    expect(isQuotaWarningDismissed(0)).toBe(true);
  });

  // 【R の記録 1】向きを縛る: ストレージが例外を投げる環境では「消していない」（警告は出る方に倒す。
  // 043 の「見た」は逆向き（既読扱い）なので、同じ形のテストで向きの違いを固定する）
  it("sessionStorage が例外を投げる環境では「消していない」扱い（false）。書き込みも例外にならない", () => {
    withThrowingStorage("sessionStorage", () => {
      expect(() => dismissQuotaWarning(4)).not.toThrow();
      expect(isQuotaWarningDismissed(4)).toBe(false);
    });
  });
});

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
