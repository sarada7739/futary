import { act, fireEvent, render, screen } from "@testing-library/react";
import { ORPCError } from "@orpc/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 024: アカウント削除画面の画面結合テスト。calendar-screen.test.tsxと
// 同じ形でoRPCクライアントをモックする
const { deleteMeMock, meGetMock, signOutMock, signInSocialMock, backMock } = vi.hoisted(() => ({
  deleteMeMock: vi.fn(),
  meGetMock: vi.fn(),
  signOutMock: vi.fn(),
  signInSocialMock: vi.fn(),
  backMock: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ back: backMock }),
}));

vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = { me: { delete: deleteMeMock, get: meGetMock } };
  return { client, orpc: createTanstackQueryUtils(client) };
});

vi.mock("../lib/auth-client", () => ({
  signOut: signOutMock,
  signIn: { social: signInSocialMock },
  // useViewerQueryKey（apps/app/lib/viewer-key.ts）がauth-client経由で参照する。
  // このテストでは識別の中身自体は検証しないため固定値を返す（profile-screen.test.tsxと同じ形）
  useSession: () => ({ data: null }),
}));

const { default: DeleteAccountScreen } = await import("../app/(tabs)/delete-account");
const { queryClient } = await import("../lib/query");

// 024・Aの決定: 削除確認画面に入れるかはme.get().sessionIsFreshで判定する。
// 既定は「直近ログイン済み（fresh）」にしておき、reauth固有のテストでのみ上書きする
function makeMe(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "me", name: "自分", email: "me@example.com", image: null, sessionIsFresh: true, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  meGetMock.mockResolvedValue(makeMe());
  signInSocialMock.mockResolvedValue(undefined);
});

function renderScreen() {
  return render(
    <QueryClientProvider client={queryClient}>
      <DeleteAccountScreen />
    </QueryClientProvider>,
  );
}

// meQuery（me.get）の解決を待ってから段階1の画面が出る。sessionIsFreshが
// 分かるまで確認フローに入れないため（下の「読み込み中」テスト参照）
async function goToStage1() {
  renderScreen();
  await screen.findByText("削除すると、次が消えます");
}

async function goToStage2() {
  await goToStage1();
  fireEvent.click(screen.getByText("次へ"));
}

describe("DeleteAccountScreen: 読み込み中・再認証", () => {
  it("me.getの応答が届くまでは読み込み中の表示で、段階1の内容は出ない", () => {
    meGetMock.mockReturnValue(new Promise(() => {}));
    renderScreen();

    expect(screen.getByText("読み込み中…")).toBeTruthy();
    expect(screen.queryByText("削除すると、次が消えます")).toBeNull();
  });

  // 024・Aの決定: 「削除確認画面に入れるか」はサーバが真偽値で返す
  // （me.get().sessionIsFresh）。falseなら確認フロー（段階1・2）に入れず、
  // 先に再ログインを促す
  it("sessionIsFreshがfalseなら確認フローに入れず、再ログインを促す", async () => {
    meGetMock.mockResolvedValue(makeMe({ sessionIsFresh: false }));
    renderScreen();

    expect(await screen.findByText("もう一度ログインしてください")).toBeTruthy();
    expect(screen.queryByText("削除すると、次が消えます")).toBeNull();
  });

  it("「もう一度ログインする」を押すとsignIn.socialが呼ばれる", async () => {
    meGetMock.mockResolvedValue(makeMe({ sessionIsFresh: false }));
    renderScreen();
    await screen.findByText("もう一度ログインしてください");

    fireEvent.click(screen.getByTestId("delete-account-reauth"));

    expect(signInSocialMock).toHaveBeenCalledTimes(1);
    expect(signInSocialMock.mock.calls[0]?.[0]).toMatchObject({ provider: "google" });
  });

  it("再ログイン画面でも「やめる」を押すとrouter.back()が呼ばれる", async () => {
    meGetMock.mockResolvedValue(makeMe({ sessionIsFresh: false }));
    renderScreen();
    await screen.findByText("もう一度ログインしてください");

    fireEvent.click(screen.getByText("やめる"));

    expect(backMock).toHaveBeenCalledTimes(1);
  });

  // 024・Aの決定（T5）: 画面側の事前チェックは通る道を整えるためのもので、
  // 止めているのはサーバである。確認をやり切る間に5分を跨いだ場合、
  // me.deleteはREAUTH_REQUIREDで拒む。画面はこれも同じ再ログイン画面に落とす
  it("確認をやり切った後にREAUTH_REQUIREDが返ると、再ログイン画面に切り替わる", async () => {
    deleteMeMock.mockRejectedValue(new ORPCError("REAUTH_REQUIRED", { defined: true }));
    await goToStage2();
    fireEvent.click(screen.getByTestId("delete-account-acknowledge"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-account-confirm"));
      await Promise.resolve();
    });

    expect(await screen.findByText("もう一度ログインしてください")).toBeTruthy();
    expect(signOutMock).not.toHaveBeenCalled();
  });
});

describe("DeleteAccountScreen: 段階1（何が消えるかの列挙）", () => {
  it("最初は段階2の内容（相手のデータが消える旨・最終ボタン）が出ていない", async () => {
    await goToStage1();

    expect(screen.getByText("削除すると、次が消えます")).toBeTruthy();
    expect(screen.queryByText("相手のデータも消えます")).toBeNull();
    expect(screen.queryByTestId("delete-account-confirm")).toBeNull();
  });

  it("「次へ」を押すと段階2に進む", async () => {
    await goToStage1();

    fireEvent.click(screen.getByText("次へ"));

    expect(screen.getByText("相手のデータも消えます")).toBeTruthy();
  });
});

describe("DeleteAccountScreen: 段階2（相手のデータも消えることの明示・最終確認）", () => {
  it("相手の投稿・リアクション・プロフィール画像が消えること、事前に知らせないことが書いてある", async () => {
    await goToStage2();

    const warning = screen.getByText(/相手が書いた投稿も消えます/);
    expect(warning.textContent).toContain("相手が押したリアクションも消えます");
    expect(warning.textContent).toContain("相手のプロフィール画像も消えます");
    expect(warning.textContent).toContain("相手には事前に知らせません");
  });

  // 024タスク定義「既定で押せる状態にしない」。チェックを入れるまで
  // 最終ボタンが押せない
  it("チェックを入れるまで最終ボタンが押せない", async () => {
    await goToStage2();

    const confirmButton = screen.getByTestId("delete-account-confirm");
    expect(confirmButton.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(screen.getByTestId("delete-account-acknowledge"));

    expect(confirmButton.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("最終ボタンを押すとme.deleteが呼ばれ、成功するとsignOutが呼ばれる", async () => {
    deleteMeMock.mockResolvedValue({ ok: true });
    await goToStage2();
    fireEvent.click(screen.getByTestId("delete-account-acknowledge"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-account-confirm"));
      await Promise.resolve();
    });

    expect(deleteMeMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  // 【security-auditor指摘】削除自体は成功したのにsignOut()側が失敗すると、
  // 同じtryで拾っていた頃は「削除できませんでした」と誤って表示していた
  // （実際には既に消えている）。削除の成否とsignOut()の成否を分けたことを
  // 直接確認する
  it("me.deleteが成功していれば、signOutが失敗してもエラーメッセージは出ない", async () => {
    deleteMeMock.mockResolvedValue({ ok: true });
    signOutMock.mockRejectedValue(new Error("signOut failed"));
    await goToStage2();
    fireEvent.click(screen.getByTestId("delete-account-acknowledge"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-account-confirm"));
      await Promise.resolve();
    });

    expect(screen.queryByText("削除できませんでした。もう一度お試しください")).toBeNull();
  });

  it("失敗するとエラーメッセージが出て、signOutは呼ばれない", async () => {
    deleteMeMock.mockRejectedValue(new Error("failed"));
    await goToStage2();
    fireEvent.click(screen.getByTestId("delete-account-acknowledge"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-account-confirm"));
      await Promise.resolve();
    });

    expect(await screen.findByText("削除できませんでした。もう一度お試しください")).toBeTruthy();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("「やめる」を押すとrouter.back()が呼ばれる", async () => {
    await goToStage2();

    fireEvent.click(screen.getByText("やめる"));

    expect(backMock).toHaveBeenCalledTimes(1);
  });
});
