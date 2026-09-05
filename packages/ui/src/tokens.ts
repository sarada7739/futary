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
  // 035で濃くした（0.04/12/y2→0.08/24/y8）。architecture.md 7節。
  // 元の値は画面上でほぼ見えず、カードが地に貼り付いて見えていた
  card: {
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  fab: {
    shadowColor: "#000000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  // 発光（影ではない）。architecture.md 7節。shadowOffsetを0,0にして方向を
  // 持たせない（下に落ちる影は「浮いている」、四方に広がる光は「光っている」で
  // 別の意味）。アバターの光るリング・FABの光彩の両方に使う（用途ごとに
  // 名前を分けない。同じ見た目に2つの名前を付けない）。数値は感覚値
  // （035。実機で調整したらarchitecture.md 7節を値と理由つきで書き直す）
  glow: {
    shadowColor: colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
} as const;

// expo-linear-gradientに渡す色の並び（035）。新しい色は増やしていない。
// 呼ぶ側で配列を組み立てない（packages/uiのコンポーネントがstyleを
// 受け取らないのと同じ理由。architecture.md 7節）
export const gradients = {
  screen: [colors.bg, colors.surfaceTint] as const,
  card: [colors.surfaceTint, colors.primarySubtle] as const,
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

export type ColorToken = keyof typeof colors;
export type SpaceToken = keyof typeof space;
