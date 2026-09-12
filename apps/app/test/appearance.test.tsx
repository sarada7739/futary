import { act, render, renderHook, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Text } from "react-native";
import {
  APPEARANCE_HTML_ATTRIBUTE,
  APPEARANCE_STORAGE_KEY,
  AppearanceProvider,
  FabIcon,
  Screen,
  useAppearance,
  useTheme,
} from "@futary/ui";

// 039: 外観（ピンク/ホワイト）の Provider と Screen の検査（タスク定義8節 T3〜T5）。
// packages/ui には jsdom・testing-library・react-native-web が無く、レンダリングを
// 伴う検査はここに置く（screen.test.tsx と同じ理由。7節「入れる依存: 無し」）

function wrapper({ children }: { children: React.ReactNode }) {
  return <AppearanceProvider>{children}</AppearanceProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  document.querySelector('meta[name="theme-color"]')?.remove();
  document.documentElement.removeAttribute(APPEARANCE_HTML_ATTRIBUTE);
});

describe("T3: AppearanceProvider と localStorage", () => {
  it("未設定なら pink", () => {
    const { result } = renderHook(() => useAppearance(), { wrapper });
    expect(result.current.appearance).toBe("pink");
  });

  it("localStorage の futary.appearance が white なら、描画直後（paint 前）に white", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "white");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.appearance).toBe("white");
    expect(result.current.colors.primary).toBe("#1D1D1F");
  });

  // 静的書き出しの HTML（pink で描かれている）を hydrate する経路。最初のクライアント
  // 描画が pink でないと React が不一致を報告し、本番では style の差が直らずに
  // ピンクが残る（AppearanceProvider のコメント参照）
  it("pink で描いたサーバ HTML を hydrate しても不一致にならず、直後に white になる", () => {
    function Probe() {
      const { colors, appearance } = useTheme();
      return <Text testID="probe" style={{ backgroundColor: colors.bg }}>{appearance}</Text>;
    }
    const ui = (
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>
    );
    // 本物の SSR 出力を使う（jsdom の innerHTML は style を正規化してしまい、
    // React のクライアント props と字面が変わって偽の不一致になる。B が実測）。
    // Provider は保存値を最初の描画で読まないため、localStorage に white が
    // 入っていても SSR と同じく pink で描く
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "white");
    const serverHtml = renderToString(ui);
    expect(serverHtml).toContain("pink");
    expect(serverHtml).toContain("rgba(254,246,243,1.00)");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.appendChild(container);
    // +html.tsx の inline script 相当: 保存値がホワイトなら hydrate 前に属性を付けて
    // #root を隠している
    document.documentElement.setAttribute(APPEARANCE_HTML_ATTRIBUTE, "white");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(ui, { container, hydrate: true });
      // hydrate の不一致（React が console.error に出す）が無い
      expect(errorSpy.mock.calls.map((c) => String(c[0])).filter((m) => /hydrat/i.test(m))).toEqual([]);
      const probe = screen.getByTestId("probe");
      expect(probe.textContent).toBe("white");
      expect(probe.style.backgroundColor).toBe("rgb(255, 255, 255)");
      // ホワイトで描き終えたので、隠していた属性が外れている
      expect(document.documentElement.hasAttribute(APPEARANCE_HTML_ATTRIBUTE)).toBe(false);
    } finally {
      errorSpy.mockRestore();
      container.remove();
    }
  });

  it("保存値がピンクなら、+html.tsx が付けなかった属性を触らない（付いていれば外さない）", () => {
    // inline script はピンクのとき属性を付けない。万一別の値が付いていても、
    // Provider は自分の外観と一致するときだけ外す
    document.documentElement.setAttribute(APPEARANCE_HTML_ATTRIBUTE, "white");
    renderHook(() => useAppearance(), { wrapper });
    expect(document.documentElement.getAttribute(APPEARANCE_HTML_ATTRIBUTE)).toBe("white");
  });
});

describe("+html.tsx の inline script と packages/ui の値が一致している", () => {
  // +html.tsx は @futary/ui を import できない（Node 側のバンドルに react-native が
  // 入る）ため、保存キーと属性名がリテラルで書かれている。文面で対応を固定する
  const htmlSource = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/+html.tsx"),
    "utf8",
  );

  it("localStorage のキーが APPEARANCE_STORAGE_KEY と同じ", () => {
    expect(htmlSource).toContain(`localStorage.getItem("${APPEARANCE_STORAGE_KEY}")==="white"`);
  });

  it("<html> に付ける属性が APPEARANCE_HTML_ATTRIBUTE と同じで、その間 #root を隠す", () => {
    expect(htmlSource).toContain(`setAttribute("${APPEARANCE_HTML_ATTRIBUTE}","white")`);
    expect(htmlSource).toContain(`html[${APPEARANCE_HTML_ATTRIBUTE}="white"] #root{visibility:hidden}`);
  });

  it("inline script は1本だけで、外部URL・利用者入力を含まない静的な文字列", () => {
    const scripts = [...htmlSource.matchAll(/<script\b[\s\S]*?__html:\s*\n?\s*'([^']*)'/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).not.toMatch(/https?:|\$\{/);
  });
});

describe("T3（続き）: 未知の値・setAppearance・theme-color", () => {

  it.each(["dark", "", "WHITE", "null", "{}"])("未知の値 %j は pink として扱う", (value) => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, value);
    const { result } = renderHook(() => useAppearance(), { wrapper });
    expect(result.current.appearance).toBe("pink");
  });

  it("setAppearance は状態と localStorage の両方を更新する", () => {
    const { result } = renderHook(() => useAppearance(), { wrapper });
    act(() => result.current.setAppearance("white"));
    expect(result.current.appearance).toBe("white");
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("white");
    act(() => result.current.setAppearance("pink"));
    expect(result.current.appearance).toBe("pink");
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("pink");
  });

  it("切り替えると同じ Provider 配下の useTheme() が即座に新しい値を返す", () => {
    const { result } = renderHook(() => ({ ...useAppearance(), theme: useTheme() }), { wrapper });
    expect(result.current.theme.colors.bg).toBe("#FEF6F3");
    act(() => result.current.setAppearance("white"));
    expect(result.current.theme.colors.bg).toBe("#FFFFFF");
    expect(result.current.theme.shadow.card.shadowOpacity).toBe(0);
    expect(result.current.theme.gradients.screen).toEqual(["#FFFFFF", "#FFFFFF"]);
  });

  it("<meta name=\"theme-color\"> を選んだ外観の primary に書き換える（起動後。inline script は使わない）", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#F5868D");
    document.head.appendChild(meta);

    const { result } = renderHook(() => useAppearance(), { wrapper });
    expect(meta.getAttribute("content")).toBe("#F5868D");
    act(() => result.current.setAppearance("white"));
    expect(meta.getAttribute("content")).toBe("#1D1D1F");
    act(() => result.current.setAppearance("pink"));
    expect(meta.getAttribute("content")).toBe("#F5868D");
  });
});

describe("T4: Provider が無いとき", () => {
  it("useTheme() は pink で動く（既存の画面結合テストがラップ無しで壊れない根拠）", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.appearance).toBe("pink");
    expect(result.current.colors.primary).toBe("#F5868D");
  });

  it("localStorage に white が入っていても、Provider が無ければ pink（保存値は Provider だけが読む）", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "white");
    const { result } = renderHook(() => useTheme());
    expect(result.current.appearance).toBe("pink");
  });

  it("useAppearance().setAppearance は何もしない（例外を投げない）", () => {
    const { result } = renderHook(() => useAppearance());
    expect(() => act(() => result.current.setAppearance("white"))).not.toThrow();
    expect(result.current.appearance).toBe("pink");
  });
});

describe("FabIcon: 中央の投稿ボタンの絵", () => {
  it("pink では従来の画像（fab-plus.png）を描き、白い円は描かない", () => {
    const { container } = render(
      <AppearanceProvider initialAppearance="pink">
        <FabIcon size={56} />
      </AppearanceProvider>,
    );
    expect(container.querySelector("img, [role='img']")).not.toBeNull();
    expect(screen.queryByTestId("fab-icon-white")).toBeNull();
  });

  it("white では画像を使わず、primary（黒）の円を描く", () => {
    const { container } = render(
      <AppearanceProvider initialAppearance="white">
        <FabIcon size={56} />
      </AppearanceProvider>,
    );
    expect(container.querySelector("img, [role='img']")).toBeNull();
    const circle = screen.getByTestId("fab-icon-white");
    expect(circle.style.backgroundColor).toBe("rgb(29, 29, 31)");
    expect(circle.style.borderTopLeftRadius).toBe("28px");
  });
});

describe("T5: Screen の光のボケ", () => {
  it("pink では描く", () => {
    render(
      <AppearanceProvider initialAppearance="pink">
        <Screen>
          <Text>中身</Text>
        </Screen>
      </AppearanceProvider>,
    );
    expect(screen.getByTestId("screen-bokeh")).toBeInTheDocument();
  });

  it("white では描かない", () => {
    render(
      <AppearanceProvider initialAppearance="white">
        <Screen>
          <Text>中身</Text>
        </Screen>
      </AppearanceProvider>,
    );
    expect(screen.queryByTestId("screen-bokeh")).toBeNull();
  });

  it("Provider 無しでも描く（pink 既定）", () => {
    render(
      <Screen>
        <Text>中身</Text>
      </Screen>,
    );
    expect(screen.getByTestId("screen-bokeh")).toBeInTheDocument();
  });
});
