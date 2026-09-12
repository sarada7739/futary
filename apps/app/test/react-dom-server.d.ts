// 039: appearance.test.tsx が静的書き出し（SSR）と同じ HTML を作るために
// react-dom/server の renderToString を使う。react-dom 本体は apps/app の依存だが
// 型定義（@types/react-dom）は入れていないため、使う1関数だけをここで宣言する
// （依存を足さない。タスク定義7節）。テスト以外から import しないこと
declare module "react-dom/server" {
  import type { ReactNode } from "react";
  export function renderToString(node: ReactNode): string;
}
