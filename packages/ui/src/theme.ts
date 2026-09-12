/**
 * 外観（appearance）ごとに変わるデザイントークン（039）。
 * `docs/architecture.md` 7節「外観」が単一の源。値を変える場合はこのファイルだけを直す。
 *
 * モードで変わるもの（colors・shadow・gradients）はここに置き、静的に export しない。
 * 画面・部品は `useTheme()` から取る（packages/ui/src/appearance.tsx）。
 * 静的 export を消したことが「直し忘れた画面がピンクのまま動く」ことを防ぐ留め金
 * （型チェックが直し忘れを全部挙げる。タスク定義1節）。
 *
 * モードで変わらないもの（radius・space・layout・fontFamily）は tokens.ts のまま。
 */

export const APPEARANCE_VALUES = ["pink", "white"] as const;
export type Appearance = (typeof APPEARANCE_VALUES)[number];
export const DEFAULT_APPEARANCE: Appearance = "pink";

export function isAppearance(value: unknown): value is Appearance {
  return typeof value === "string" && (APPEARANCE_VALUES as readonly string[]).includes(value);
}

// 役割ごとに1トークン。キーの集合は両モードで同一（ホワイトだけ・ピンクだけの色を
// 作らない。タスク定義1節）。`Record<ColorToken, string>` を両パレットに要求する
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

export type Theme = Readonly<{
  appearance: Appearance;
  colors: Colors;
  shadow: Shadow;
  gradients: Gradients;
}>;

// ---------------------------------------------------------------------------
// ピンク（035）。039 で値を1つも変えていない（T1 が凍結した写しと突き合わせる）
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
  // 画像の全画面表示（017）の背景。ブランドの暖色とは無関係な機能色のため、
  // パレットから離れた黒系の半透明にしている
  overlay: "rgba(20, 15, 14, 0.92)",
  // カレンダー（011）のイベント種別マーカー。3種を色相で離す
  // （赤系/黄系/青緑系）。色だけに頼らず形（グリフ）も併用するのは呼び出し側の責務
  eventAnniversary: "#E36387",
  eventPlan: "#D9A441",
  eventMeetup: "#4C8C8B",
  // 取り返しのつかない操作（退会）専用。architecture.md 7節。036
  danger: "#C9423C",
};

// borderRadius と対で使う。web では影が要素の輪郭に沿って落ちるため、
// 丸い要素に角丸を付け忘れると四角い影になる（fix/fab-shadow-square）
const pinkShadow: Shadow = {
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
  // 名前を分けない。同じ見た目に2つの名前を付けない）。数値は感覚値（035）
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

// ---------------------------------------------------------------------------
// ホワイト（039）。Apple の Web サイト・iOS 設定アプリの語彙: 白地、#1D1D1F の文字、
// 薄いグレーの枠線、余白で区切る、装飾は無い。数値は B が決めた（決定権は B。
// 理由は docs/tasks/039-white-mode.md の進捗と architecture.md 7節）
// ---------------------------------------------------------------------------

const whiteColors: Colors = {
  // 真っ白。地とカードが同じ色になるので、カードは影ではなく枠線で浮く
  bg: "#FFFFFF",
  surface: "#FFFFFF",
  // Apple のグレー地（apple.com の背景セクション・iOS 設定のグループ地）。
  // 押下時・写真タイルの地
  surfaceTint: "#F5F5F7",
  // 黒が主色。FAB・アクティブなタブ・primary ボタン。純黒 #000000 ではなく
  // Apple の文字色 #1D1D1F（純黒は白地の上でコントラストが強すぎて硬い）
  primary: "#1D1D1F",
  // 押下時: 黒を「少し持ち上げる」。iOS の systemGray5 系の暗い側
  primaryPressed: "#3A3A3C",
  // バッジの地。surfaceTint と同値でよい（役割が違う。ピンクでは値が違う）
  primarySubtle: "#F5F5F7",
  // 見出しも黒。ホワイトには「ブランドの茶色」に相当する色が無い
  brandInk: "#1D1D1F",
  text: "#1D1D1F",
  // Apple の副次テキスト色。白地でのコントラスト比 3.5:1（12pt の補助文字には十分）
  textMuted: "#86868B",
  // ホワイトでは枠線が唯一の輪郭。apple.com のヘアライン #D2D2D7 を採用。
  // iOS の separator（#C6C6C8 の不透明相当）と #E5E5EA の中間で、白地の上で
  // 1px でも確実に見える濃さ（035 で border が薄すぎた教訓）
  border: "#D2D2D7",
  // 以下は機能色。モードで変えない
  overlay: pinkColors.overlay,
  eventAnniversary: pinkColors.eventAnniversary,
  eventPlan: pinkColors.eventPlan,
  eventMeetup: pinkColors.eventMeetup,
  danger: pinkColors.danger,
};

// 「無し」は不透明度 0 で表す（値で表せるものは値で表す。タスク定義3節）
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
  // 残す。黒い FAB も白地の上で浮いている必要がある。ピンク（0.15/6/y3）より
  // ぼかしと落差を少し広げた（0.18/10/y4）: 黒い円は輪郭が強く、狭い影だと
  // 「貼ったシール」に見える。広めの薄い影で地から離す
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

// 平ら。両端を同じ色にして LinearGradient を「ただの塗り」にする
// （部品側で分岐しなくて済む）
const whiteGradients: Gradients = {
  screen: [whiteColors.bg, whiteColors.bg],
  card: [whiteColors.surface, whiteColors.surface],
};

export const themes: Readonly<Record<Appearance, Theme>> = {
  pink: { appearance: "pink", colors: pinkColors, shadow: pinkShadow, gradients: pinkGradients },
  white: { appearance: "white", colors: whiteColors, shadow: whiteShadow, gradients: whiteGradients },
};

// T2 用: 型の Record は余分なキーを弾けないため、テストが Object.keys で見る
export const COLOR_TOKEN_LIST: readonly ColorToken[] = COLOR_TOKENS;
