import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 008: ホーム画面・投稿作成画面の画面結合テスト。Playwright は014まで入れない
// （007の決定。conventions.md 6節）ため、oRPC クライアントをモックして
// react-native-web + jsdom 上でTanStack Queryの実挙動と組み合わせて検証する。
// モックする以上サーバとの契約自体は検証していない（実機確認で見る）
const { listMock, createMock, pushMock, backMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  pushMock: vi.fn(),
  backMock: vi.fn(),
}));

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
      delete: vi.fn(),
      uploadUrl: vi.fn(),
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
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
