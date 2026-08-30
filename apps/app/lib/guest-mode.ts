import { createContext, useContext } from "react";

// ゲストデモ（未認証での閲覧）の状態（docs/tasks/014-guest-demo.md）。
// サインイン画面の「ゲストではじめる」で入り、書き込み系のUIから
// exitGuestMode() を呼ぶとサインイン画面へ戻る。
//
// サーバ側の拒否が唯一の防御線であり、このフラグは UI の見せ方だけを
// 決める（architecture.md 5節・security-requirements.md 3節）。
// このフラグを立てなくても、未認証アクセスは常にデモペアの読み取り専用
// アクセスになる（005 の認可ミドルウェア）
export interface GuestModeState {
  isGuestMode: boolean;
  enterGuestMode: () => void;
  exitGuestMode: () => void;
  // デモの解決に失敗して（couple.getがFORBIDDEN等）サインイン画面へ
  // 戻された直後だけtrue。理由を1行出すために使う（architecture.md 7節
  // 「ゲストの解決に失敗したら、サインイン画面へ戻す。理由を1行出す。
  // 黙って空白にしない」。Rレビュー指摘R-1・A決定）
  demoUnavailable: boolean;
}

// 既定値はisGuestMode:false（通常の非デモ画面と同じ振る舞い）。
// 画面結合テストの多くはRootLayoutを経由せず各画面を単体でレンダリングするため、
// Providerが無い前提でも動く既定値にしている（Providerが無いことをエラーに
// すると、テストごとにラップを増やす必要が出る）
const defaultGuestModeState: GuestModeState = {
  isGuestMode: false,
  enterGuestMode: () => {},
  exitGuestMode: () => {},
  demoUnavailable: false,
};

export const GuestModeContext = createContext<GuestModeState>(defaultGuestModeState);

export function useGuestMode(): GuestModeState {
  return useContext(GuestModeContext);
}
