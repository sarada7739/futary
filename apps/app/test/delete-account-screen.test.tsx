import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 024: アカウント削除画面の画面結合テスト。calendar-screen.test.tsxと
// 同じ形でoRPCクライアントをモックする
const { deleteMeMock, signOutMock, backMock } = vi.hoisted(() => ({
  deleteMeMock: vi.fn(),
  signOutMock: vi.fn(),
  backMock: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ back: backMock }),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = { me: { delete: deleteMeMock } };
  return { client, orpc: createTanstackQueryUtils(client) };
});

vi.mock("../lib/auth-client", () => ({
  signOut: signOutMock,
}));

const { default: DeleteAccountScreen } = await import("../app/(tabs)/delete-account");
const { queryClient } = await import("../lib/query");

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

function renderScreen() {
  return render(
    <QueryClientProvider client={queryClient}>
      <DeleteAccountScreen />
    </QueryClientProvider>,
  );
}

describe("DeleteAccountScreen: 段階1（何が消えるかの列挙）", () => {
  it("最初は段階2の内容（相手のデータが消える旨・最終ボタン）が出ていない", () => {
    renderScreen();

    expect(screen.getByText("削除すると、次が消えます")).toBeTruthy();
    expect(screen.queryByText("相手のデータも消えます")).toBeNull();
    expect(screen.queryByTestId("delete-account-confirm")).toBeNull();
  });

  it("「次へ」を押すと段階2に進む", () => {
    renderScreen();

    fireEvent.click(screen.getByText("次へ"));

    expect(screen.getByText("相手のデータも消えます")).toBeTruthy();
  });
});

describe("DeleteAccountScreen: 段階2（相手のデータも消えることの明示・最終確認）", () => {
  function goToStage2() {
    renderScreen();
    fireEvent.click(screen.getByText("次へ"));
  }

  it("相手の投稿・リアクション・プロフィール画像が消えること、事前に知らせないことが書いてある", () => {
    goToStage2();

    const warning = screen.getByText(/相手が書いた投稿も消えます/);
    expect(warning.textContent).toContain("相手が押したリアクションも消えます");
    expect(warning.textContent).toContain("相手のプロフィール画像も消えます");
    expect(warning.textContent).toContain("相手には事前に知らせません");
  });

  // 024タスク定義「既定で押せる状態にしない」。チェックを入れるまで
  // 最終ボタンが押せない
  it("チェックを入れるまで最終ボタンが押せない", () => {
    goToStage2();

    const confirmButton = screen.getByTestId("delete-account-confirm");
    expect(confirmButton.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(screen.getByTestId("delete-account-acknowledge"));

    expect(confirmButton.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("最終ボタンを押すとme.deleteが呼ばれ、成功するとsignOutが呼ばれる", async () => {
    deleteMeMock.mockResolvedValue({ ok: true });
    goToStage2();
    fireEvent.click(screen.getByTestId("delete-account-acknowledge"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-account-confirm"));
      await Promise.resolve();
    });

    expect(deleteMeMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("失敗するとエラーメッセージが出て、signOutは呼ばれない", async () => {
    deleteMeMock.mockRejectedValue(new Error("failed"));
    goToStage2();
    fireEvent.click(screen.getByTestId("delete-account-acknowledge"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-account-confirm"));
      await Promise.resolve();
    });

    expect(await screen.findByText("削除できませんでした。もう一度お試しください")).toBeTruthy();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("「やめる」を押すとrouter.back()が呼ばれる", () => {
    goToStage2();

    fireEvent.click(screen.getByText("やめる"));

    expect(backMock).toHaveBeenCalledTimes(1);
  });
});
