import { fireEvent, render, screen } from "@testing-library/react";
import { AppearanceProvider } from "@futary/ui";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 043 T5: リリース履歴の一覧。最新の 1 枚だけ NEW! と primary の枠・route の無い項目に「新機能を見る」が無い。
// ヘッダーの ‹ 戻る は navigation.setOptions で置くため、渡された headerLeft を描画して確かめる
// （album-screen.test.tsx と同じ形）
const { pushMock, setOptionsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  setOptionsMock: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock }),
  useNavigation: () => ({ setOptions: setOptionsMock }),
}));

const { default: ReleasesScreen } = await import("../app/(tabs)/releases");
const { RELEASES } = await import("../lib/releases");
const { RELEASE_SEEN_STORAGE_KEY } = await import("../lib/release-seen");
const { themes } = await import("../../../packages/ui/src/theme");

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

function renderIn(ui: ReactElement, appearance: "pink" | "white" = "pink") {
  return render(<AppearanceProvider initialAppearance={appearance}>{ui}</AppearanceProvider>);
}

function hex(color: string): string {
  // "rgb(245, 134, 141)" → "#f5868d"（jsdom の computed style は rgb() で返る）
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return color.toLowerCase();
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
}

describe("ReleasesScreen（043 T5）", () => {
  it("12 項目が新しい順に全部出る（日付は YYYY.MM.DD・版のチップ・題名・箇条書き）", () => {
    renderIn(<ReleasesScreen />);
    expect(screen.getByText("これまでのアップデートをご紹介。")).toBeTruthy();
    for (const release of RELEASES) {
      expect(screen.getByTestId(`release-card-${release.version}`)).toBeTruthy();
      expect(screen.getByText(`v${release.version}`)).toBeTruthy();
      for (const item of release.items) expect(screen.getByText(item)).toBeTruthy();
    }
    // 2026.09.14 は 2.0.0（アルバム）と 2.2.0（ZIP。048）の 2 枚にある
    expect(screen.getAllByText("2026.09.14")).toHaveLength(2);
    expect(screen.getByText("アルバム機能を追加")).toBeTruthy();
    expect(screen.getByText("アルバムの写真をまとめて持ち出せます")).toBeTruthy();
    expect(screen.getByText("futary リリース 🎉")).toBeTruthy();
    // 並びは配列の順（DOM の順で比べる）
    const cards = RELEASES.map((r) => screen.getByTestId(`release-card-${r.version}`));
    for (let i = 1; i < cards.length; i++) {
      expect(cards[i - 1]!.compareDocumentPosition(cards[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("最新の 1 枚だけ NEW! が付き、枠が primary（他は primary ではない）", () => {
    renderIn(<ReleasesScreen />);
    expect(screen.getAllByTestId("release-card-new")).toHaveLength(1);
    const latest = screen.getByTestId(`release-card-${RELEASES[0]!.version}`);
    expect(latest).toContainElement(screen.getByTestId("release-card-new"));

    const primary = themes.pink.colors.primary.toLowerCase();
    expect(hex(getComputedStyle(latest).borderTopColor)).toBe(primary);
    const second = screen.getByTestId(`release-card-${RELEASES[1]!.version}`);
    expect(hex(getComputedStyle(second).borderTopColor)).not.toBe(primary);
  });

  it("ホワイトでも最新だけ primary の枠、他は border の 1px", () => {
    renderIn(<ReleasesScreen />, "white");
    const latest = screen.getByTestId(`release-card-${RELEASES[0]!.version}`);
    expect(hex(getComputedStyle(latest).borderTopColor)).toBe(themes.white.colors.primary.toLowerCase());
    const second = screen.getByTestId(`release-card-${RELEASES[1]!.version}`);
    expect(hex(getComputedStyle(second).borderTopColor)).toBe(themes.white.colors.border.toLowerCase());
  });

  it("route がある項目だけ「新機能を見る →」があり、押すとその画面へ", () => {
    renderIn(<ReleasesScreen />);
    for (const release of RELEASES) {
      const button = screen.queryByTestId(`release-open-${release.version}`);
      if (release.route) expect(button, release.version).toBeTruthy();
      else expect(button, release.version).toBeNull();
    }
    fireEvent.click(screen.getByTestId("release-open-2.2.0"));
    expect(pushMock).toHaveBeenCalledWith("/album");
    fireEvent.click(screen.getByTestId("release-open-1.1.0"));
    expect(pushMock).toHaveBeenCalledWith("/calendar");
  });

  it("開いた時点で既読になる（T4 の一覧側）", () => {
    expect(window.localStorage.getItem(RELEASE_SEEN_STORAGE_KEY)).toBeNull();
    renderIn(<ReleasesScreen />);
    expect(window.localStorage.getItem(RELEASE_SEEN_STORAGE_KEY)).toBe(RELEASES[0]!.version);
  });

  it("ヘッダーの ‹ 戻る は / へ固定", () => {
    renderIn(<ReleasesScreen />);
    const options = setOptionsMock.mock.calls.at(-1)?.[0] as { headerLeft: () => ReactElement };
    render(options.headerLeft());
    fireEvent.click(screen.getByTestId("releases-back"));
    expect(pushMock).toHaveBeenCalledWith("/");
  });
});
