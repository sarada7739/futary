import { createContext, useContext } from "react";

// ゲストデモ（未認証の閲覧）の状態（014）。「ゲストではじめる」で入り、書き込みの UI から exitGuestMode() で戻る。
// このフラグは見せ方だけを決め、防御線はサーバの拒否（未認証は常にデモペアの読み取り専用。
// architecture.md 5節・security-requirements.md 3節）
export interface GuestModeState {
  isGuestMode: boolean;
  enterGuestMode: () => void;
  exitGuestMode: () => void;
  // デモの解決に失敗してサインイン画面へ戻された直後だけ true（理由を 1 行出す。黙って空白にしない。architecture.md 3節）
  demoUnavailable: boolean;
}

// 既定は isGuestMode:false。画面結合テストの多くは RootLayout を通らないので、Provider が無くても動く既定にする
// （エラーにするとテストごとにラップが要る）
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
