import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 008: ホーム画面・投稿作成画面の画面結合テスト。Playwright は014まで入れない
// （007の決定。conventions.md 6節）ため、oRPC クライアントをモックして
// react-native-web + jsdom 上でTanStack Queryの実挙動と組み合わせて検証する。
// モックする以上サーバとの契約自体は検証していない（実機確認で見る）
const { listMock, createMock, deleteMock, toggleReactionMock, statsGetMock, pushMock, backMock } = vi.hoisted(
  () => ({
    listMock: vi.fn(),
    createMock: vi.fn(),
    deleteMock: vi.fn(),
    toggleReactionMock: vi.fn(),
    statsGetMock: vi.fn(),
    pushMock: vi.fn(),
    backMock: vi.fn(),
  }),
);

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: pushMock, back: backMock }),
}));

// expo-image-picker は "expo" パッケージの副作用のあるセットアップ（__DEV__ を
// 参照する async-require）を経由でロードし、Vitest（jsdom）環境では
// __DEV__ 未定義でクラッシュする。今回のテストでは画像選択を操作しないため、
// 実体は使わず最小のスタブに差し替える
vi.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}));

// ../lib/image が読み込む expo-image-manipulator も同じ理由（__DEV__未定義）で
// 素の import では落ちる。image.test.ts と同じ最小スタブに差し替える
vi.mock("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: vi.fn() },
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "me", name: "自分", email: "me@example.com", image: null } },
    isPending: false,
  }),
}));

// client（生のoRPC呼び出し）だけを差し替え、createTanstackQueryUtilsは本物を使う。
// queryOptions/infiniteOptions/mutationOptionsの実装自体はモックしない
vi.mock("../lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    post: {
      list: listMock,
      create: createMock,
      delete: deleteMock,
      uploadUrl: vi.fn(),
    },
    reaction: {
      toggle: toggleReactionMock,
    },
    stats: {
      get: statsGetMock,
    },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { default: HomeScreen } = await import("../app/(tabs)/index");
const { default: ComposeScreen } = await import("../app/compose");
const { queryClient } = await import("../lib/query");

function makePost(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "post-1",
    authorId: "me",
    authorName: "自分",
    authorImage: null,
    body: "こんにちは",
    imageUrl: null,
    imageWidth: null,
    imageHeight: null,
    createdAt: Math.floor(Date.now() / 1000),
    reactions: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  // ホーム画面が012でStatsCardを組み込んだため、投稿一覧のテストが壊れないよう
  // 既定値を用意する（このファイルの主眼は投稿一覧であり、統計カード自体の
  // 検証はstats-card.test.tsxで行う）
  statsGetMock.mockResolvedValue({
    daysTogether: { status: "together", days: 1 },
    meetupCount: 0,
    postCount: 0,
    photoCount: 0,
    members: [{ userId: "me", name: "自分", image: null }],
  });
});

describe("HomeScreen", () => {
  it("投稿一覧が表示される", async () => {
    listMock.mockResolvedValue({ items: [makePost()], nextCursor: null });

    render(
      <QueryClientProvider client={queryClient}>
        <HomeScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("こんにちは")).toBeTruthy();
  });

  it("投稿ゼロで「最初の思い出を残そう」の空状態が出る", async () => {
    listMock.mockResolvedValue({ items: [], nextCursor: null });

    render(
      <QueryClientProvider client={queryClient}>
        <HomeScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("まだ投稿がありません")).toBeTruthy();
    expect(screen.getByText("最初の思い出を残そう")).toBeTruthy();
  });
});

describe("投稿作成 → 一覧反映", () => {
  it("投稿作成後、一覧の再取得で新しい投稿が反映される", async () => {
    const created = makePost({ id: "new-post", body: "新しい投稿" });
    listMock.mockResolvedValueOnce({ items: [], nextCursor: null });
    createMock.mockResolvedValue(created);
    listMock.mockResolvedValueOnce({ items: [created], nextCursor: null });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <HomeScreen />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("まだ投稿がありません")).toBeTruthy();

    rerender(
      <QueryClientProvider client={queryClient}>
        <ComposeScreen />
      </QueryClientProvider>,
    );

    const input = screen.getByPlaceholderText("今日の出来事を書く");
    fireEvent.change(input, { target: { value: "新しい投稿" } });
    await act(async () => {
      fireEvent.click(screen.getByText("投稿する"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ body: "新しい投稿" }), expect.anything()),
    );
    await waitFor(() => expect(backMock).toHaveBeenCalled());

    rerender(
      <QueryClientProvider client={queryClient}>
        <HomeScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("新しい投稿")).toBeTruthy();
  });
});

describe("投稿の削除", () => {
  // 008 完了条件「自分の投稿を削除できる」の唯一の自動検証。Rレビュー指摘:
  // artifacts/008/manual-check.md が「UIからの削除操作は未確認」と正直に書いた
  // ことで、削除メニュー押下 → post.delete 呼び出し → 一覧から消える、という
  // 一連の流れを検証するテストが1件も無いことが判明した（スクリーンショット
  // 要件の撤回〈conventions.md 8節〉により、UIの担保は自動テストに寄せる
  // 方針になったため、この穴は埋める必要がある）
  it("「…」→「削除」の操作で post.delete が呼ばれ、一覧から消える", async () => {
    const post = makePost({ id: "post-to-delete", body: "消される投稿" });
    listMock.mockResolvedValueOnce({ items: [post], nextCursor: null });
    deleteMock.mockResolvedValue({ id: post.id });
    // onSuccess の invalidateQueries による再取得では、削除済みの投稿を含まない
    listMock.mockResolvedValueOnce({ items: [], nextCursor: null });

    render(
      <QueryClientProvider client={queryClient}>
        <HomeScreen />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("消される投稿")).toBeTruthy();

    // 「…」を押すと確認用の「削除」ボタンが現れる（誤タップ防止。post-card.tsx）
    fireEvent.click(screen.getByTestId("post-card-menu"));
    await act(async () => {
      fireEvent.click(screen.getByText("削除"));
      await Promise.resolve();
    });

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith({ id: post.id }, expect.anything()));
    await waitFor(() => expect(screen.queryByText("消される投稿")).toBeNull());
  });
});

describe("リアクション（楽観的更新）", () => {
  it("サーバの応答を待たずタップした瞬間に反映される", async () => {
    const post = makePost({ reactions: [] });
    listMock.mockResolvedValue({ items: [post], nextCursor: null });
    // toggle をわざと未解決のままにし、応答前に見た目が変わっているかを確認する
    let resolveToggle: (value: unknown) => void = () => {};
    toggleReactionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveToggle = resolve;
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <HomeScreen />
      </QueryClientProvider>,
    );
    const button = await screen.findByTestId("post-card-reaction-heart");
    expect(button.textContent).toBe("🤍");

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });

    // toggleReactionMock はまだ resolve していないが、見た目は既に反応済み
    // （onMutate 自身が非同期のため、反映まで数マイクロタスクかかる）
    await waitFor(() => expect(button.textContent).toBe("❤️ 1"));

    await act(async () => {
      resolveToggle({ postId: post.id, kind: "heart", reacted: true });
      await Promise.resolve();
    });
  });

  it("失敗したら楽観的更新前の見た目に戻る", async () => {
    const post = makePost({ reactions: [] });
    listMock.mockResolvedValue({ items: [post], nextCursor: null });
    let rejectToggle: (error: unknown) => void = () => {};
    toggleReactionMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectToggle = reject;
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <HomeScreen />
      </QueryClientProvider>,
    );
    const button = await screen.findByTestId("post-card-reaction-heart");
    expect(button.textContent).toBe("🤍");

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    await waitFor(() => expect(button.textContent).toBe("❤️ 1"));

    await act(async () => {
      rejectToggle(new Error("toggle失敗（テスト用）"));
      await Promise.resolve();
    });

    await waitFor(() => expect(button.textContent).toBe("🤍"));
  });
});
