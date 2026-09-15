import { fireEvent, render, screen } from "@testing-library/react";
import { Linking } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 052: サインイン画面の下にプライバシーポリシー・利用規約のリンクがあり、
// 押すとサイトのルート（/privacy・/terms。ランディングと同じ静的 HTML）を開く（T3）。
// ページはアプリ（/app/*）の外にあるため expo-router ではなく Linking.openURL で開く
// （apps/app/components/legal-links.tsx）

const { signInSocialMock, enterGuestModeMock } = vi.hoisted(() => ({
  signInSocialMock: vi.fn(),
  enterGuestModeMock: vi.fn(),
}));

vi.mock("../lib/auth-client", () => ({
  signIn: { social: signInSocialMock },
}));

vi.mock("../lib/guest-mode", () => ({
  useGuestMode: () => ({ enterGuestMode: enterGuestModeMock, demoUnavailable: false }),
}));

const { default: SignInScreen } = await import("../app/(auth)/sign-in");
const { getApiOrigin } = await import("../lib/api-origin");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SignInScreen: プライバシーポリシー・利用規約（052）", () => {
  it("2 つのリンクがあり、押すと Linking.openURL でサイトのルートの /privacy・/terms を開く", () => {
    const openUrl = vi.spyOn(Linking, "openURL").mockResolvedValue(true);
    render(<SignInScreen />);

    fireEvent.click(screen.getByTestId("legal-privacy"));
    expect(openUrl).toHaveBeenCalledWith(`${getApiOrigin()}/privacy`);

    fireEvent.click(screen.getByTestId("legal-terms"));
    expect(openUrl).toHaveBeenCalledWith(`${getApiOrigin()}/terms`);

    expect(openUrl).toHaveBeenCalledTimes(2);
    // ログインのボタンは巻き込まれない（リンクを押してもサインインは始まらない）
    expect(signInSocialMock).not.toHaveBeenCalled();
    expect(enterGuestModeMock).not.toHaveBeenCalled();
  });

  it("リンクの文言は「プライバシーポリシー」「利用規約」で、/app の中を指さない", () => {
    render(<SignInScreen />);

    expect(screen.getByTestId("legal-privacy")).toHaveTextContent("プライバシーポリシー");
    expect(screen.getByTestId("legal-terms")).toHaveTextContent("利用規約");
    // オリジン直下（/privacy）であって /app/privacy ではない
    expect(`${getApiOrigin()}/privacy`).not.toContain("/app/");
  });
});
