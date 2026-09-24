/**
 * 外観ごとに変わるデザイントークン（039）。単一の源は `docs/architecture.md` 7節「外観」。
 *
 * 外観で変わるもの（colors・shadow・gradients・glass）は静的に export せず、`useTheme()` から取る
 * （静的 export が無いので、直し忘れた画面は型チェックで全部挙がる）。
 * 変わらないもの（radius・space・layout・fontFamily）は tokens.ts。
 */

export const APPEARANCE_VALUES = ["pink", "white"] as const;
export type Appearance = (typeof APPEARANCE_VALUES)[number];
export const DEFAULT_APPEARANCE: Appearance = "pink";

export function isAppearance(value: unknown): value is Appearance {
  return typeof value === "string" && (APPEARANCE_VALUES as readonly string[]).includes(value);
}

// 役割ごとに 1 トークン。キーの集合は両外観で同一（片方だけの色を作らない）
const COLOR_TOKENS = [
  "bg",
  "surface",
  "surfaceTint",
  "primary",
  "primaryPressed",
  "primarySubtle",
  "brandInk",
  "text",
  "textMuted",
  "border",
  "overlay",
  "eventAnniversary",
  "eventPlan",
  "eventMeetup",
  "danger",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
export type Colors = Readonly<Record<ColorToken, string>>;

export type ShadowStyle = Readonly<{
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: Readonly<{ width: number; height: number }>;
  elevation: number;
}>;

export type Shadow = Readonly<{
  card: ShadowStyle;
  fab: ShadowStyle;
  glow: ShadowStyle;
}>;

// expo-linear-gradient に渡す色の並び。呼ぶ側で配列を組み立てない
export type Gradients = Readonly<{
  screen: readonly [string, string];
  card: readonly [string, string];
}>;

// ガラスのタブバー（061）。ぼかし量・フチの光は外観で変わるので colors でなくここに置く
// （colors は 1 つの色の役割で、数値や複数の役割を混ぜない）
export type Glass = Readonly<{
  // backdrop-filter の blur 半径（px）と saturate の倍率
  blurRadius: number;
  saturate: number;
  // ガラス板そのものの色（半透明）
  tint: string;
  // 外周の細い線
  rim: string;
  // 左上から光が当たったフチ
  edgeHighlight: string;
  // 反対側（右下）の弱い反射
  edgeReflection: string;
  // 色収差の横ずれ（px）。0 なら色収差を出さない
  aberration: number;
  // 色収差の2色（左右のフチに振り分ける）
  aberrationCool: string;
  aberrationWarm: string;
  // 選択中のピル（レンズ）
  lensTint: string;
  lensRim: string;
}>;

export type Theme = Readonly<{
  appearance: Appearance;
  colors: Colors;
  shadow: Shadow;
  gradients: Gradients;
  glass: Glass;
}>;

// ---------------------------------------------------------------------------
// ピンク（035）。T1 が凍結した写しと突き合わせる
// ---------------------------------------------------------------------------

const pinkColors: Colors = {
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
  // 画像の全画面表示の背景。ブランドの暖色と無関係な機能色なので黒系の半透明
  overlay: "rgba(20, 15, 14, 0.92)",
  // カレンダーの種別マーカー。3 種を色相で離す（形も併用するのは呼び出し側）
  eventAnniversary: "#E36387",
  eventPlan: "#D9A441",
  eventMeetup: "#4C8C8B",
  // 取り返しのつかない操作（退会）専用（architecture.md 7節）
  danger: "#C9423C",
};

// borderRadius と対で使う（web では影が輪郭に沿うので、角丸を付け忘れると四角い影になる）
const pinkShadow: Shadow = {
  // 薄いとカードが地に貼り付いて見える（architecture.md 7節）
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
  // 発光（影ではない）。offset 0,0 で方向を持たせない（落ちる影は「浮いている」、四方の光は「光っている」）。
  // アバターのリングと FAB の光彩の両方に使う（同じ見た目に 2 つの名前を付けない）
  glow: {
    shadowColor: pinkColors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
};

const pinkGradients: Gradients = {
  screen: [pinkColors.bg, pinkColors.surfaceTint],
  card: [pinkColors.surfaceTint, pinkColors.primarySubtle],
};

// 地が淡い桜色なので、白を強く混ぜると曇りすぎる。tint を薄くして彩度を上げ、背後の色を残す
const pinkGlass: Glass = {
  blurRadius: 20,
  saturate: 1.8,
  tint: "rgba(255, 255, 255, 0.42)",
  rim: "rgba(255, 255, 255, 0.55)",
  edgeHighlight: "rgba(255, 255, 255, 0.85)",
  edgeReflection: "rgba(255, 255, 255, 0.3)",
  aberration: 1.2,
  aberrationCool: "rgba(0, 220, 255, 0.4)",
  aberrationWarm: "rgba(255, 0, 200, 0.32)",
  lensTint: "rgba(245, 134, 141, 0.2)",
  lensRim: "rgba(255, 255, 255, 0.75)",
};

// ---------------------------------------------------------------------------
// ホワイト（039）。Apple の Web サイト・iOS 設定アプリの語彙: 白地、#1D1D1F の文字、薄いグレーの枠線、
// 余白で区切る、装飾は無い（architecture.md 7節）
// ---------------------------------------------------------------------------

const whiteColors: Colors = {
  // 真っ白。地とカードが同じ色になるので、カードは影ではなく枠線で浮く
  bg: "#FFFFFF",
  surface: "#FFFFFF",
  // Apple のグレー地。押下時・写真タイルの地
  surfaceTint: "#F5F5F7",
  // 黒が主色（FAB・アクティブなタブ・primary ボタン）。純黒は白地の上で硬いので #1D1D1F
  primary: "#1D1D1F",
  // 押下時: 黒を少し持ち上げる
  primaryPressed: "#3A3A3C",
  // バッジの地。surfaceTint と同値（役割が違う）
  primarySubtle: "#F5F5F7",
  // 見出しも黒（ホワイトにはブランドの茶色に当たる色が無い）
  brandInk: "#1D1D1F",
  text: "#1D1D1F",
  // 白地でコントラスト比 3.5:1（12pt の補助文字には足りる）
  textMuted: "#86868B",
  // ホワイトでは枠線が唯一の輪郭。apple.com のヘアライン。白地の上で 1px でも確実に見える濃さ
  border: "#D2D2D7",
  // 以下は機能色。モードで変えない
  overlay: pinkColors.overlay,
  eventAnniversary: pinkColors.eventAnniversary,
  eventPlan: pinkColors.eventPlan,
  eventMeetup: pinkColors.eventMeetup,
  danger: pinkColors.danger,
};

// 「無し」は不透明度 0 で表す（値で表せるものは値で表す）
const NO_SHADOW: ShadowStyle = {
  shadowColor: "#000000",
  shadowOpacity: 0,
  shadowRadius: 0,
  shadowOffset: { width: 0, height: 0 },
  elevation: 0,
};

const whiteShadow: Shadow = {
  // 無し。代わりに Card が border 1px の枠線を持つ
  card: NO_SHADOW,
  // 黒い FAB も白地から浮かせる。黒い円は輪郭が強く、狭い影だと貼ったシールに見えるので、広めの薄い影
  fab: {
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  // 無し。発光はピンクの語彙で、ホワイトには無い
  glow: NO_SHADOW,
};

// 平ら。両端を同じ色にして LinearGradient をただの塗りにする（部品で分岐しない）
const whiteGradients: Gradients = {
  screen: [whiteColors.bg, whiteColors.bg],
  card: [whiteColors.surface, whiteColors.surface],
};

// 「装飾は無い」に合わせて色を持たせず、色収差も 0（虹色のにじみはピンクの語彙）。
// 地が真っ白なので、輪郭は光でなく薄いグレーの線で出す
const whiteGlass: Glass = {
  blurRadius: 24,
  saturate: 1.1,
  tint: "rgba(255, 255, 255, 0.6)",
  rim: "rgba(0, 0, 0, 0.1)",
  edgeHighlight: "rgba(255, 255, 255, 0.9)",
  edgeReflection: "rgba(0, 0, 0, 0.03)",
  aberration: 0,
  // aberration が 0 なので使われないが、キーの集合を両外観で揃えるために置く
  aberrationCool: "transparent",
  aberrationWarm: "transparent",
  lensTint: "rgba(29, 29, 31, 0.06)",
  lensRim: "rgba(0, 0, 0, 0.12)",
};

export const themes: Readonly<Record<Appearance, Theme>> = {
  pink: { appearance: "pink", colors: pinkColors, shadow: pinkShadow, gradients: pinkGradients, glass: pinkGlass },
  white: { appearance: "white", colors: whiteColors, shadow: whiteShadow, gradients: whiteGradients, glass: whiteGlass },
};

// 型の Record は余分なキーを弾けないので、テストが Object.keys で見る
export const COLOR_TOKEN_LIST: readonly ColorToken[] = COLOR_TOKENS;
