import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { isInFrame } from "./demo-frame";
import { LATEST_VERSION } from "./releases";

// 043: リリース履歴の「見た」（タスク定義 2節）。端末だけに持つ（サーバに持たない。0節 #2）。
// - localStorage["futary.releaseSeen"]: 最後に見た版。LATEST_VERSION と一致しなければ未読
// - sessionStorage["futary.releaseLater"]: この起動で「後で通知する」を押した版。
//   同じ起動の中ではシートを出し直さない（ホームに戻るたびに出すのはうるさい。0節 #4）
// 版の比較は文字列の一致だけ（大小を比べない）。
// ストレージが使えない（例外・プライベートモード・静的書き出し中）ときは「見た」扱い
// （バッジもシートも出さない。毎回シートが出る方が害。0節 #9）。
// `window.localStorage` と明示する理由は packages/ui/src/appearance.tsx と同じ
// （Node 25 の裸の `localStorage` はメソッドの無い空オブジェクト）
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

// 未読なら true。読めない（undefined）なら false（0節 #9）
export function hasUnseenRelease(): boolean {
  const seen = readKey("local", RELEASE_SEEN_STORAGE_KEY);
  if (seen === undefined) return false;
  return seen !== LATEST_VERSION;
}

// 056 0節 #3c: LP のスマホの枠（iframe）の中では書かない（同じオリジンの localStorage なので、框で書くと
// 本物の /app/ でお知らせが出なくなる）。「後で」（sessionStorage）も同じ
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

// ホームのボタンのバッジは、一覧の画面（別のルート）が markReleaseSeen() を呼んだ瞬間に消える必要がある
// （T4「ホームに戻るとバッジが無い」）。Tabs の中の画面は遷移しても mount されたままなので、
// フォーカスのフックに頼らず、このモジュールの購読で知らせる。
// 静的書き出し（サーバ側の描画）では window が無いので false（バッジ無し）で描く
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
