import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import { DEFAULT_APPEARANCE, isAppearance, themes, type Appearance, type Theme } from "./theme";

// 外観の設定（039）。保存先は端末（Web は localStorage）。サーバに置かず、相手に反映せず、ゲストでも使える
// （ADR-014）。秘密ではないので localStorage でよい（security-requirements.md 2節が禁じるのは秘密）。
// ネイティブはまだ配布していないのでメモリに持つだけ（要るときは read/write だけを差し替える。
// @react-native-async-storage は足さない）
export const APPEARANCE_STORAGE_KEY = "futary.appearance";

// +html.tsx の inline script が、保存値がホワイトのとき hydrate 前に <html> へ付ける属性（その間 #root を
// 隠す）。Provider がホワイトで描き終えたら外す。+html.tsx は @futary/ui を import できない（Node 側の
// バンドルに react-native が入る）ので向こうはリテラル。対応は apps/app/test/appearance.test.tsx が見る
export const APPEARANCE_HTML_ATTRIBUTE = "data-appearance";

function storage(): Storage | null {
  if (Platform.OS !== "web") return null;
  try {
    // `window.localStorage` と明示する（裸の `localStorage` は Node 22 以降の実験的な global を指すことがあり、
    // jsdom でもそれが勝って setItem が無い）。静的書き出し（Node）では window が無いので pink。
    // プライベートモード・埋め込み等では参照自体が例外を投げる
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

// 未知の値・壊れた値・未設定は pink（未知の値で壊れない）
export function readStoredAppearance(): Appearance {
  const store = storage();
  if (!store) return DEFAULT_APPEARANCE;
  try {
    const value = store.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearance(value) ? value : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeStoredAppearance(appearance: Appearance): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(APPEARANCE_STORAGE_KEY, appearance);
  } catch {
    // 容量超過・書き込み禁止でも切り替え自体は成り立たせる（次回起動時に pink へ戻るだけ）
  }
}

export type AppearanceState = {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
};

// Provider が無いとき（画面結合テストの多く）は pink で動く（エラーにするとテストごとにラップが要る）
const defaultAppearanceState: AppearanceState = {
  appearance: DEFAULT_APPEARANCE,
  setAppearance: () => {},
};

const AppearanceContext = createContext<AppearanceState>(defaultAppearanceState);

export type AppearanceProviderProps = {
  children: ReactNode;
  // テスト用。省略時は端末の保存値（無ければ pink）から始める
  initialAppearance?: Appearance;
};

// ルートに 1 つ置く。最初の描画は必ず pink（サーバと同じ）にし、useLayoutEffect で保存値へ切り替える。
// Web は静的書き出しで、HTML の pink の中身をクライアントが hydrate する。最初から white で描くと
// hydrate の不一致になり、React は本番で style の差を直さないのでピンクが残る。
// layout effect の setState は paint 前に同期で描き直すので、一瞬ピンクを見ることは無い
export function AppearanceProvider({ children, initialAppearance }: AppearanceProviderProps) {
  const [appearance, setAppearanceState] = useState<Appearance>(initialAppearance ?? DEFAULT_APPEARANCE);

  useLayoutEffect(() => {
    if (initialAppearance !== undefined) return;
    const stored = readStoredAppearance();
    if (stored !== DEFAULT_APPEARANCE) setAppearanceState(stored);
  }, [initialAppearance]);

  // +html.tsx の inline script が hydrate 前に #root を隠している。その外観で描き終えた commit の後に外す
  // （上の effect より後に宣言してあるので、最初の pink の commit ではまだ外れない）
  useLayoutEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const html = document.documentElement;
    if (html.getAttribute(APPEARANCE_HTML_ATTRIBUTE) === appearance) {
      html.removeAttribute(APPEARANCE_HTML_ATTRIBUTE);
    }
  }, [appearance]);

  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState(next);
    writeStoredAppearance(next);
  }, []);

  // ブラウザの外枠の色（<meta name="theme-color">。+html.tsx はピンクで書き出す）を選んだ外観に合わせる。
  // 起動後に JS で書き換える（一瞬ピンクでも実害は無い）。+html.tsx の inline script は「ピンクが見える」
  // のを防ぐ最小限の 1 本で、実害の無いものまで hydrate 前に動かす理由が無い
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", themes[appearance].colors.primary);
  }, [appearance]);

  const value = useMemo<AppearanceState>(() => ({ appearance, setAppearance }), [appearance, setAppearance]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceState {
  return useContext(AppearanceContext);
}

// 画面は `const { colors } = useTheme()` に置き換えるだけ。見た目の判断を画面に書かない
export function useTheme(): Theme {
  const { appearance } = useContext(AppearanceContext);
  return themes[appearance];
}
