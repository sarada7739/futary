import { Platform } from "react-native";

// アルバム詳細の「残り N 枚です」の警告は × で消せる（045）。消した状態はこの起動の間だけ（sessionStorage）。
// 残り枚数が変わればまた出す（消したときの枚数と一致するときだけ隠す）。ストレージが使えないときは消していない
// 扱い（警告は出る側に倒す）。`window.sessionStorage` と明示する理由は lib/release-seen.ts
export const QUOTA_WARNING_DISMISSED_STORAGE_KEY = "futary.quotaWarningDismissed";

function sessionStorageOrNull(): Storage | null {
  if (Platform.OS !== "web") return null;
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

// 消したときの残り枚数と一致するときだけ true
export function isQuotaWarningDismissed(remaining: number): boolean {
  const store = sessionStorageOrNull();
  if (!store) return false;
  try {
    return store.getItem(QUOTA_WARNING_DISMISSED_STORAGE_KEY) === String(remaining);
  } catch {
    return false;
  }
}

export function dismissQuotaWarning(remaining: number): void {
  const store = sessionStorageOrNull();
  if (!store) return;
  try {
    store.setItem(QUOTA_WARNING_DISMISSED_STORAGE_KEY, String(remaining));
  } catch {
    // 書けなくても落とさない（次に開いたときにまた出るだけ）
  }
}
