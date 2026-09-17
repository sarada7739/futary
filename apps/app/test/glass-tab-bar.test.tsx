import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppearanceProvider, type Appearance } from "@futary/ui";
import { fireEvent, render } from "@testing-library/react";
import { Pressable, Text } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { GlassTabBar, type GlassTabBarProps } from "../components/glass-tab-bar";

// 061: 湾曲ガラスのタブバー。
//
// 見た目（ぼかし・屈折・色収差）は react-native-web が CSS クラスに畳むため
// DOM から値を読み取れない。値そのものはソースの不変条件として検査し
// （danger-variant-scope.test.ts と同じ形）、DOM では振る舞いだけを見る。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(testDir, "..");

function readSource(relative: string): string {
  return readFileSync(path.join(appDir, relative), "utf8");
}

// --- 描画用の最小の props -----------------------------------------------------

type RouteSpec = { name: string; title: string; hidden?: boolean; fab?: boolean };

const ROUTES: RouteSpec[] = [
  { name: "index", title: "ホーム" },
  { name: "calendar", title: "カレンダー" },
  { name: "post", title: "", fab: true },
  { name: "timeline", title: "タイムライン" },
  { name: "profile", title: "マイページ" },
  { name: "memory", title: "思い出", hidden: true },
];

function makeProps(options: { focusedName?: string; preventDefault?: boolean } = {}) {
  const focusedName = options.focusedName ?? "index";
  const emit = vi.fn(() => ({ defaultPrevented: options.preventDefault ?? false }));
  const navigate = vi.fn();

  const routes = ROUTES.map((spec) => ({ key: `${spec.name}-key`, name: spec.name, params: undefined }));
  const descriptors: Record<string, { options: Record<string, unknown> }> = {};
  for (const spec of ROUTES) {
    descriptors[`${spec.name}-key`] = {
      options: {
        title: spec.title,
        // **`href: null` は navigator まで届かない。**expo-router が手前で剥がし、
        // `tabBarItemStyle: { display: "none" }` と「null を返す tabBarButton」に
        // 置き換える（expo-router/build/layouts/TabsClient.js の processor）。
        // ここで `href: null` を渡す形にすると、本番に存在しない条件を検査する
        // だけのテストになる（実際にそう書いていて、隠し画面が全部タブに並ぶ
        // 不具合を緑のまま通した）。実物と同じ形を作る
        ...(spec.hidden
          ? { tabBarItemStyle: { display: "none" }, tabBarButton: () => null }
          : {}),
        ...(spec.fab
          ? {
              tabBarButton: (buttonProps: { onPress?: () => void }) => (
                <Pressable onPress={buttonProps.onPress}>
                  <Text>＋投稿</Text>
                </Pressable>
              ),
            }
          : { tabBarIcon: () => <Text>{`icon:${spec.name}`}</Text> }),
      },
    };
  }

  const state = {
    index: ROUTES.findIndex((spec) => spec.name === focusedName),
    routes,
    key: "tabs",
    routeNames: ROUTES.map((spec) => spec.name),
    type: "tab",
    stale: false as const,
    history: [],
    preloadedRouteKeys: [],
  };

  // navigator が渡す本物の型は expo-router の内部にあり、テストから組み立てられる
  // 形ではない（Descriptor は navigation・render を含む）。この部品が実際に読むのは
  // state・descriptors[key].options・navigation の emit/navigate だけなので、
  // その3つだけを持つ最小の形を作って1度だけ型を当てる（any は使わない）
  const props = { state, descriptors, navigation: { emit, navigate }, insets: { top: 0, bottom: 0, left: 0, right: 0 } };
  return { props: props as unknown as GlassTabBarProps, emit, navigate };
}

function renderBar(props: GlassTabBarProps, appearance: Appearance = "pink") {
  return render(
    <AppearanceProvider initialAppearance={appearance}>
      <GlassTabBar {...props} />
    </AppearanceProvider>,
  );
}

// --- 振る舞い ---------------------------------------------------------------

describe("G1: 出す項目", () => {
  // この検査だけでは足りない。隠し画面の tabBarButton は null を返すので、
  // 除外に失敗していても文字は出ない（＝壊れた実装でも通る）。幅を食うかどうかは
  // 下の「スロットの数」で見る（R レビュー記録3）
  it("隠し画面の文字がタブに出ない（これだけでは除外の証明にならない）", () => {
    const { props } = makeProps();
    const { queryByText, getByText } = renderBar(props);

    expect(getByText("ホーム")).toBeTruthy();
    expect(getByText("カレンダー")).toBeTruthy();
    expect(getByText("タイムライン")).toBeTruthy();
    expect(getByText("マイページ")).toBeTruthy();
    expect(queryByText("思い出")).toBeNull();
  });

  // 隠し画面を数に入れると、スロットが増えて本物のタブが潰れる
  // （実測: (tabs)/_layout.tsx の隠し画面 12 枚ぶん、5 → 17 スロットになった）
  it("スロットの数が、出す項目の数と一致する（隠し画面が幅を食わない）", () => {
    const { props } = makeProps();
    const { container } = renderBar(props);

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    // タブ4つ ＋ ＋投稿の枠1つ
    expect(tablist?.children).toHaveLength(5);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
  });

  it("隠し画面を開いているときはピルを出さない", () => {
    const { props } = makeProps({ focusedName: "memory" });
    const { container } = renderBar(props);
    expect(container.querySelectorAll('[aria-selected="true"]')).toHaveLength(0);
  });

  it("tabBarButton を持つ項目は、その部品がそのまま描かれる（＋投稿の FAB）", () => {
    const { props } = makeProps();
    const { getByText } = renderBar(props);
    expect(getByText("＋投稿")).toBeTruthy();
  });

  it("アイコンは descriptors の tabBarIcon から描く（見た目の設定は _layout に残す）", () => {
    const { props } = makeProps();
    const { getByText } = renderBar(props);
    expect(getByText("icon:index")).toBeTruthy();
  });
});

describe("G2: 選択状態", () => {
  it("選択中の項目にだけ aria-selected が付く", () => {
    const { props } = makeProps({ focusedName: "calendar" });
    const { container } = renderBar(props);

    const selected = container.querySelectorAll('[aria-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain("カレンダー");
  });
});

describe("G3: 押したときの遷移", () => {
  it("tabPress を emit し、止められなければ navigate する", () => {
    const { props, emit, navigate } = makeProps({ focusedName: "index" });
    const { getByText } = renderBar(props);

    fireEvent.click(getByText("タイムライン"));

    expect(emit).toHaveBeenCalledWith({
      type: "tabPress",
      target: "timeline-key",
      canPreventDefault: true,
    });
    expect(navigate).toHaveBeenCalledWith("timeline", undefined);
  });

  it("選択中の項目を押しても navigate しない", () => {
    const { props, emit, navigate } = makeProps({ focusedName: "index" });
    const { getByText } = renderBar(props);

    fireEvent.click(getByText("ホーム"));

    expect(emit).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  // ＋投稿は listeners で preventDefault され /compose を開く（(tabs)/_layout.tsx）。
  // ここで navigate すると二重に動く
  it("preventDefault されたら navigate しない（＋投稿の経路）", () => {
    const { props, emit, navigate } = makeProps({ focusedName: "index", preventDefault: true });
    const { getByText } = renderBar(props);

    fireEvent.click(getByText("＋投稿"));

    expect(emit).toHaveBeenCalledWith({
      type: "tabPress",
      target: "post-key",
      canPreventDefault: true,
    });
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("G4: 外観", () => {
  it("ピンクでもホワイトでも描ける（039 の両外観）", () => {
    for (const appearance of ["pink", "white"] as const) {
      const { props } = makeProps();
      const { getByText, unmount } = renderBar(props, appearance);
      expect(getByText("ホーム")).toBeTruthy();
      unmount();
    }
  });
});

// --- ソースの不変条件 ---------------------------------------------------------

describe("G5: ぼかしと屈折を別の層に分ける", () => {
  // 1つの宣言にまとめると、url() を解釈しない Safari が宣言ごと捨てたときに
  // ぼかしまで消える（components/glass-tab-bar.tsx 冒頭のコメント）
  it("ぼかしの宣言に url( を含めない", () => {
    const source = readSource("components/glass-tab-bar.tsx");
    const blurLine = source.split("\n").find((line) => line.includes("const blur ="));
    expect(blurLine).toBeDefined();
    expect(blurLine).not.toContain("url(");
  });

  it("屈折は backdrop-filter と filter の両方に置く（Chromium 以外でも板は歪む）", () => {
    const source = readSource("components/glass-tab-bar.tsx");
    expect(source).toContain("backdropFilter: `url(#${glass.filterId})`");
    expect(source).toContain("filter: `url(#${glass.filterId})`");
  });
});

describe("G6: SVG フィルタの id が theme と +html.tsx で一致する", () => {
  // 片方だけ直すと参照が壊れる。参照が解決できない filter を指定した要素は
  // 仕様上まったく描画されなくなるため、ずれると「タブバーが消える」
  it("theme.ts の filterId が全部 +html.tsx に定義されている", () => {
    const theme = readFileSync(
      path.resolve(appDir, "..", "..", "packages", "ui", "src", "theme.ts"),
      "utf8",
    );
    const html = readSource("app/+html.tsx");

    const themeIds = [...theme.matchAll(/filterId: "([^"]+)"/g)].map((m) => m[1]);
    const htmlIds = [...html.matchAll(/glassFilter\("([^"]+)"/g)].map((m) => m[1]);

    expect(themeIds.length).toBeGreaterThan(0);
    expect([...themeIds].sort()).toEqual([...htmlIds].sort());
  });
});
