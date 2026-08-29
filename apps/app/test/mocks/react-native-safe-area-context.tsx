// react-native-safe-area-context はネイティブモジュールで Flow 構文を含み、
// Vitest（jsdom）では変換できない。テストでは safe area の実際の余白は問題に
// ならないため、children をそのまま描画するだけの最小モックに差し替える
// （vitest.config.ts の resolve.alias）
import type { ReactNode, CSSProperties } from "react";

export function SafeAreaView({
  children,
  style,
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return <div style={style}>{children}</div>;
}
