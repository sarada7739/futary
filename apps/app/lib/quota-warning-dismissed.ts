import { Platform } from "react-native";

// 045（人間の指示。2026-09-14）: アルバム詳細の「残り N 枚です」の警告カードは × で消せる。
// 消した状態はこの起動の間だけ（sessionStorage。043 の「後で通知する」と同じ寿命）。
// 残り枚数が減ったら（写真を足したら）もう一度出す（消したときの残り枚数を覚えておき、一致するときだけ隠す）。
// ストレージが使えないときは「消していない」扱い（警告は出る方に倒す。上限に近いことを伝えるのが役目）。
// `window.sessionStorage` と明示する理由は lib/release-seen.ts と同じ
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
