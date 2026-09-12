/**
 * デザイントークンのうち、外観（ピンク/ホワイト）で変わらないもの。
 * `docs/architecture.md` 7節が単一の源。値を変える場合はこのファイルだけを直す。
 *
 * 色・影・グラデーションは外観で変わるため、ここには無い（039）。
 * packages/ui/src/theme.ts に置き、`useTheme()` から取る
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

// architecture.md 7節「レイアウト」。640の根拠は画像の保存解像度（長辺1600px。
// 表示640 CSS pxはRetina〈2倍〉でも1280 device pxで元画像の内側に収まる）
export const layout = {
  maxWidth: 640,
} as const;

// 035書体仕様1節。日本語にWebフォントを当てず、フォールバックの並びだけ
// 明示する（0KB）。iOS/macOSはヒラギノ、Windowsは`BIZ UDPGothic`を
// `Yu Gothic UI`より先に置く（Windows 10 1809以降に同梱。かなが大きく
// 線が太めで、Yu Gothicの「細くて薄い」印象が消える）
const JA_STACK =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "BIZ UDPGothic", "Meiryo", "Yu Gothic UI", "Noto Sans CJK JP", "Noto Sans JP", sans-serif';

export const fontFamily = {
  ja: JA_STACK,
  // 数字・欧文のみで構成される要素専用（記念日カードの72pt・会った日数の
  // 数字・COMING SOON）。日本語が混ざる行には使わない（桁ごとに幅が変わる
  // Poppinsを日本語の中に混ぜると落ち着かないため。035書体仕様2節）。
  // 後ろにjaの列を続けるのは、万一日本語が混ざったときに欠けさせないため
  numeric: `Poppins, ${JA_STACK}`,
} as const;

export type SpaceToken = keyof typeof space;
