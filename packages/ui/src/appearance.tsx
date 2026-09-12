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

// 外観の設定（039）。保存先は端末（Web は localStorage）。サーバに置かない・
// 相手に反映しない・ゲストでも使える（ADR-014）。
//
// localStorage に置いてよい: security-requirements.md 2節が禁じているのは秘密で、
// これは秘密ではない（expo-secure-store を使わない。秘密ではないものを秘密の箱に
// 入れない）。
//
// ネイティブ（iOS）はまだ配布していない（requirements.md 5節）ため、
// Platform.OS !== "web" ではメモリに持つだけ。インターフェースは同じにしておき、
// 保存が要る日が来たらこのファイルの read/write だけを差し替える
// （@react-native-async-storage は足さない。依存を増やさない）
export const APPEARANCE_STORAGE_KEY = "futary.appearance";

// apps/app/app/+html.tsx の inline script が、保存値がホワイトのとき hydrate 前に
// <html> へ付ける属性（その間 #root を隠す）。Provider がホワイトで描き終えたら外す。
// +html.tsx は @futary/ui を import できない（Node 側のバンドルに react-native が
// 入るため）ので、そちらはリテラル。対応は apps/app/test/appearance.test.tsx が検査する
export const APPEARANCE_HTML_ATTRIBUTE = "data-appearance";

function storage(): Storage | null {
  if (Platform.OS !== "web") return null;
  try {
    // `window.localStorage` と明示する。裸の `localStorage` は Node 22 以降の
    // 実験的な global（メソッドを持たない空のオブジェクト。--localstorage-file
    // 無しの Node 25 で実測）を指すことがあり、jsdom のテスト環境でも Node の
    // ものが勝って setItem が無い。静的書き出し（Node で描く）では window が
    // 無いので pink で描く。
    // プライベートモード・埋め込み等では参照自体が例外を投げる環境がある
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

// 未知の値・壊れた値・未設定は pink（未知の値で壊れない。タスク定義2節）
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
    // 容量超過・書き込み禁止でも画面の切り替え自体は成立させる（メモリ上の
    // state は更新済み）。次回起動時に pink へ戻るだけで、壊れはしない
  }
}

export type AppearanceState = {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
};

// Provider が無いとき（画面結合テストの多く）は pink で動く（apps/app/lib/guest-mode.ts
// と同じ理由・同じ形。Provider が無いことをエラーにすると、テストごとにラップを
// 増やす必要が出る）
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

// ルートに1つ置く。
//
// 最初の描画は必ず pink（サーバと同じ）にし、useLayoutEffect で保存値へ切り替える。
// 理由: Web は静的書き出し（app.json の web.output: "static"）で、書き出した HTML には
// pink で描かれた中身があり、クライアントはそれを hydrate する（HTML に
// `__EXPO_ROUTER_HYDRATE__=true`。B が apps/api/public/app/(tabs)/index.html で実測）。
// 最初のクライアント描画を保存値（white）にすると hydrate の不一致になり、React は
// 本番では属性（style）の差を直さないため、サーバの pink がそのまま残る。
// layout effect 内の setState は paint 前に同期で再描画されるため、ホワイトを選んだ
// 人が起動のたびに一瞬ピンクを見ることは無い（タスク定義1節・確認観点）
export function AppearanceProvider({ children, initialAppearance }: AppearanceProviderProps) {
  const [appearance, setAppearanceState] = useState<Appearance>(initialAppearance ?? DEFAULT_APPEARANCE);

  useLayoutEffect(() => {
    if (initialAppearance !== undefined) return;
    const stored = readStoredAppearance();
    if (stored !== DEFAULT_APPEARANCE) setAppearanceState(stored);
  }, [initialAppearance]);

  // +html.tsx の inline script が hydrate 前に #root を隠している（保存値がホワイトの
  // とき）。その外観で描き終えた commit の後に外す。上の effect より後に宣言してある
  // ので、最初の commit（pink）ではまだ外れず、切り替え後の commit で外れる
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

  // ブラウザの外枠の色（<meta name="theme-color">。apps/app/app/+html.tsx が
  // ピンクのリテラルで書き出している）を、選んだ外観の primary に合わせる。
  // 起動後に JS から書き換える（theme-color は外枠の色で、一瞬ピンクでも実害は
  // 無い。タスク定義1節）。inline script を足さないのは、CSP（apps/api/public/
  // _headers）が Expo Router の唯一の inline script を sha256 で固定しているため
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

// 画面ファイルは `const { colors } = useTheme()` に置き換えるだけ。見た目の判断を
// 画面に書かない（タスク定義1節）
export function useTheme(): Theme {
  const { appearance } = useContext(AppearanceContext);
  return themes[appearance];
}
