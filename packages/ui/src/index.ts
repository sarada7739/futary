// colors・shadow・gradients は静的に export しない（039）。`useTheme()` から取る。
// themes（パレットの実体）も export しない: 出すと `themes.pink.colors` で
// 静的に取れてしまい、静的 export を消した意味（留め金）が無くなる。
// 値の凍結テスト（T1）は packages/ui/test から ./theme を直接読む
export * from "./tokens";
export {
  APPEARANCE_VALUES,
  DEFAULT_APPEARANCE,
  isAppearance,
  type Appearance,
  type ColorToken,
  type Colors,
  type Gradients,
  type Shadow,
  type ShadowStyle,
  type Theme,
} from "./theme";
export {
  APPEARANCE_HTML_ATTRIBUTE,
  APPEARANCE_STORAGE_KEY,
  AppearanceProvider,
  useAppearance,
  useTheme,
  type AppearanceProviderProps,
  type AppearanceState,
} from "./appearance";
export * from "./components/text";
export * from "./components/button";
export * from "./components/card";
export * from "./components/badge";
export * from "./components/avatar";
export * from "./components/screen";
export * from "./components/fab";
export * from "./assets";
