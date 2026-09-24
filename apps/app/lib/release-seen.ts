import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { isInFrame } from "./demo-frame";
import { LATEST_VERSION } from "./releases";

// リリース履歴の「見た」。端末だけに持つ（043）。
// - localStorage["futary.releaseSeen"]: 最後に見た版。LATEST_VERSION と一致しなければ未読（大小は比べない）
// - sessionStorage["futary.releaseLater"]: この起動で「後で通知する」を押した版（ホームに戻るたびに出さない）
// ストレージが使えないときは「見た」扱い（毎回シートが出る方が害）。`window.localStorage` と明示する理由は appearance.tsx
export const RELEASE_SEEN_STORAGE_KEY = "futary.releaseSeen";
export const RELEASE_LATER_STORAGE_KEY = "futary.releaseLater";

function storageOf(kind: "local" | "session"): Storage | null {
  if (Platform.OS !== "web") return null;
  try {
    if (typeof window === "undefined") return null;
    return (kind === "local" ? window.localStorage : window.sessionStorage) ?? null;
  } catch {
    return null;
  }
}

function readKey(kind: "local" | "session", key: string): string | null | undefined {
  const store = storageOf(kind);
  if (!store) return undefined;
  try {
    return store.getItem(key);
  } catch {
    return undefined;
  }
}

function writeKey(kind: "local" | "session", key: string, value: string): void {
  const store = storageOf(kind);
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    // 書けない環境では何もしない（次も出るだけ。読めない環境は hasUnseenRelease が false）
  }
}

// --- 「見た」 ---------------------------------------------------------------------------

// 未読なら true。読めない（undefined）なら false
export function hasUnseenRelease(): boolean {
  const seen = readKey("local", RELEASE_SEEN_STORAGE_KEY);
  if (seen === undefined) return false;
  return seen !== LATEST_VERSION;
}

// LP のスマホの枠の中では書かない（同じオリジンなので、枠で書くと本物の /app/ でお知らせが出なくなる）。「後で」も同じ
export function markReleaseSeen(): void {
  if (isInFrame()) return;
  writeKey("local", RELEASE_SEEN_STORAGE_KEY, LATEST_VERSION);
  notify();
}

// --- 「後で」（同じ起動の中だけ） --------------------------------------------------------

export function isReleaseDeferred(): boolean {
  return readKey("session", RELEASE_LATER_STORAGE_KEY) === LATEST_VERSION;
}

export function deferRelease(): void {
  if (isInFrame()) return;
  writeKey("session", RELEASE_LATER_STORAGE_KEY, LATEST_VERSION);
}

// --- 画面から購読する ------------------------------------------------------------------

// ホームのバッジは、一覧の画面が markReleaseSeen() を呼んだ瞬間に消える必要がある。Tabs の中の画面は
// 遷移しても mount されたままなので、フォーカスのフックでなくこの購読で知らせる。
// 静的書き出しでは window が無いので false（バッジ無し）で描く
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function useHasUnseenRelease(): boolean {
  return useSyncExternalStore(subscribe, hasUnseenRelease, () => false);
}
