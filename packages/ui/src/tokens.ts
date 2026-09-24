/**
 * デザイントークンのうち外観で変わらないもの。単一の源は `docs/architecture.md` 7節。
 * 色・影・グラデーションは外観で変わるので theme.ts（`useTheme()` から取る）
 */

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

// 640 の根拠は画像の保存解像度（長辺 1600px。Retina の 2 倍でも 1280 device px で元画像の内側に収まる）
export const layout = {
  maxWidth: 640,
} as const;

// 日本語に Web フォントを当てず、フォールバックの並びだけを明示する（0KB）。Windows は BIZ UDPGothic を
// Yu Gothic UI より先に置く（10 1809 以降に同梱。かなが大きく線が太めで、細くて薄い印象が消える）
const JA_STACK =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "BIZ UDPGothic", "Meiryo", "Yu Gothic UI", "Noto Sans CJK JP", "Noto Sans JP", sans-serif';

export const fontFamily = {
  ja: JA_STACK,
  // 数字・欧文だけの要素専用（記念日の 72pt・会った日数の数字）。日本語の行には使わない（桁ごとに幅が変わる
  // Poppins を日本語に混ぜると落ち着かない）。後ろに ja の列を続けるのは、万一日本語が混ざっても欠けさせないため
  numeric: `Poppins, ${JA_STACK}`,
} as const;

export type SpaceToken = keyof typeof space;
