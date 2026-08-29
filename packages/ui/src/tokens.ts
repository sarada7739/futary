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
