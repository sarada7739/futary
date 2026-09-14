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
});
