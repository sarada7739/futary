import { fireEvent, render, screen } from "@testing-library/react";
import { AppearanceProvider } from "@futary/ui";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 045 T7b: /premium。「トライアル」の文字が無い・申し込みのボタンが無い・ゲストでも開ける・
// ‹ 戻る は履歴があれば back()、無ければ /album。ヘッダーは navigation.setOptions で置くため、
// 渡された headerLeft を描画して確かめる（releases-screen.test.tsx と同じ形）
const { pushMock, backMock, canGoBackMock, setOptionsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  backMock: vi.fn(),
  canGoBackMock: vi.fn(() => true),
  setOptionsMock: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock, back: backMock, canGoBack: canGoBackMock }),
  useNavigation: () => ({ setOptions: setOptionsMock }),
}));

const { default: PremiumScreen } = await import("../app/(tabs)/premium");
const { GuestModeContext } = await import("../lib/guest-mode");

beforeEach(() => {
  vi.clearAllMocks();
  canGoBackMock.mockReturnValue(true);
});

function renderIn(ui: ReactElement, appearance: "pink" | "white" = "pink") {
  return render(<AppearanceProvider initialAppearance={appearance}>{ui}</AppearanceProvider>);
}

function renderHeaderLeft() {
  const last = setOptionsMock.mock.calls.at(-1)?.[0] as { headerLeft?: () => ReactElement } | undefined;
  if (!last?.headerLeft) return null;
  return render(last.headerLeft());
}

describe("PremiumScreen（045 T7b）", () => {
  it("題名・副題・「写真枚数 無制限」の 1 行・「お申し込みは準備中です」が出る", () => {
    renderIn(<PremiumScreen />);
    expect(screen.getByTestId("premium-title")).toHaveTextContent("プレミアムプラン");
    expect(screen.getByText("大切な思い出を、もっと自由に。")).toBeTruthy();
    expect(screen.getByText("写真枚数 無制限")).toBeTruthy();
    expect(screen.getByTestId("premium-coming-soon")).toHaveTextContent("お申し込みは準備中です");
  });

  it("「トライアル」「お試し」の文字が無い。申し込みのボタンが無い。価格・存在しない機能を書かない", () => {
    renderIn(<PremiumScreen />);
    expect(screen.queryByText(/トライアル/)).toBeNull();
    expect(screen.queryByText(/お試し/)).toBeNull();
    expect(screen.queryByRole("button", { name: /申し込|始める/ })).toBeNull();
    expect(screen.queryByText(/¥/)).toBeNull();
    expect(screen.queryByText(/月額|年額/)).toBeNull();
    expect(screen.queryByText(/アルバムグループ|高画質|優先サポート|動画/)).toBeNull();
  });

  it("ゲストでも開ける（ログイン案内に置き換わらない）", () => {
    render(
      <AppearanceProvider initialAppearance="pink">
        <GuestModeContext.Provider
          value={{ isGuestMode: true, enterGuestMode: () => {}, exitGuestMode: () => {}, demoUnavailable: false }}
        >
          <PremiumScreen />
        </GuestModeContext.Provider>
      </AppearanceProvider>,
    );
    expect(screen.getByTestId("premium-title")).toHaveTextContent("プレミアムプラン");
    expect(screen.getByTestId("premium-coming-soon")).toBeTruthy();
  });

  it("‹ 戻る: 履歴があれば back()、無ければ /album", () => {
    renderIn(<PremiumScreen />);
    renderHeaderLeft();
    fireEvent.click(screen.getByTestId("premium-back"));
    expect(backMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();

    canGoBackMock.mockReturnValue(false);
    fireEvent.click(screen.getByTestId("premium-back"));
    expect(pushMock).toHaveBeenCalledWith("/album");
  });

  it("絵はピンクでハート、ホワイトで ✦（どちらも既存の線画）", () => {
    const pink = renderIn(<PremiumScreen />, "pink");
    expect(screen.getByTestId("premium-picture-heart")).toBeTruthy();
    pink.unmount();
    renderIn(<PremiumScreen />, "white");
    expect(screen.getByTestId("premium-picture-sparkle")).toBeTruthy();
  });
});
