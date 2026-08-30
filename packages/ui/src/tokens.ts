/**
 * デザイントークン。`docs/architecture.md` 7節が単一の源。
 * 値を変える場合はこのファイルだけを直す。
 */

export const colors = {
  bg: "#FEF6F3",
  surface: "#FFFFFF",
  surfaceTint: "#FCEEEC",
  primary: "#F5868D",
  primaryPressed: "#E4707A",
  primarySubtle: "#FCE4E4",
  brandInk: "#7B4A3C",
  text: "#4A3733",
  textMuted: "#A08C87",
  border: "#F2E0DC",
  // 画像の全画面表示（017）の背景。ブランドの暖色とは無関係な機能色のため、
  // パレットから離れた黒系の半透明にしている
  overlay: "rgba(20, 15, 14, 0.92)",
  // カレンダー（011）のイベント種別マーカー。3種を色相で離す
  // （赤系/黄系/青緑系）。色だけに頼らず形（グリフ）も併用するのは呼び出し側の責務
  eventAnniversary: "#E36387",
  eventPlan: "#D9A441",
  eventMeetup: "#4C8C8B",
} as const;

export const radius = {
  card: 20,
  input: 14,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// borderRadius と対で使う。web では影が要素の輪郭に沿って落ちるため、
// 丸い要素に角丸を付け忘れると四角い影になる（fix/fab-shadow-square）
export const shadow = {
  card: {
    shadowColor: "#000000",
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  fab: {
    shadowColor: "#000000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
} as const;

// architecture.md 7節「レイアウト」。640の根拠は画像の保存解像度（長辺1600px。
// 表示640 CSS pxはRetina〈2倍〉でも1280 device pxで元画像の内側に収まる）
export const layout = {
  maxWidth: 640,
} as const;

export type ColorToken = keyof typeof colors;
export type SpaceToken = keyof typeof space;
