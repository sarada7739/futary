import { Stack } from "expo-router";

// このファイルが無いと、ファイルシステム上「(auth)」はグループとして
// 登録されず、直下の "sign-in.tsx" が "(auth)/sign-in" という平らな名前で
// 登録される。ルート_layout.tsxのStack.Screen name="(auth)"がどの画面にも
// 一致しなくなり、「No route named "(auth)" exists in nested children」
// という警告が出ていた（(tabs)・(onboarding)と同じくグループには
// _layout.tsxが要る）。
//
// 【調査メモ】この警告は実際に「ゲストではじめる→/composeに飛んで読み込み中の
// まま止まる」不具合の原因の1つかと疑ったが、実測すると無関係だった
// （このファイルを足しても不具合は再現し続けた）。真因は
// apps/app/app/_layout.tsxの識別変化エフェクトが呼んでいた
// `queryClient.clear()`だった。このファイルは単に上記の警告を消す
// ためのもの（グループとしての正しい構成）として残している
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
