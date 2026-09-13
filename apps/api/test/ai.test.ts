import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPrompt,
  buildProviderRequest,
  generateSummary,
  MAX_INPUT_CHARS,
  resolveAiConfig,
  type PostEntry,
} from "../src/lib/ai";

// 037タスク定義3節: AI_PROVIDERが指すプロバイダのキーが無ければ落とす
// （BETTER_AUTH_SECRETと同じfail-closed）
describe("resolveAiConfig", () => {
  it("providerがopenai/anthropicのどちらでもなければ落ちる", () => {
    expect(() => resolveAiConfig({ provider: undefined })).toThrow(/AI_PROVIDER/);
    expect(() => resolveAiConfig({ provider: "azure" })).toThrow(/AI_PROVIDER/);
  });

  it("providerがopenaiでもOPENAI_API_KEYが無ければ落ちる", () => {
    expect(() => resolveAiConfig({ provider: "openai" })).toThrow(/OPENAI_API_KEY|APIキー/);
  });

  it("providerがanthropicでもANTHROPIC_API_KEYが無ければ落ちる", () => {
    expect(() => resolveAiConfig({ provider: "anthropic" })).toThrow(/ANTHROPIC_API_KEY|APIキー/);
  });

  it("両方揃っていても、AI_PROVIDERが指さない方のキーは見ない", () => {
    // openaiを指しているのにopenaiキーが無く、anthropicキーだけあっても落ちる
    // （タスク定義3節「両方のキーを同時に読まない」の裏側の確認）
    expect(() =>
      resolveAiConfig({ provider: "openai", anthropicApiKey: "anthropic-key-only" }),
    ).toThrow(/OPENAI_API_KEY|APIキー/);
  });

  it("providerに対応するキーがあれば通る", () => {
    expect(() => resolveAiConfig({ provider: "openai", openaiApiKey: "sk-test" })).not.toThrow();
    expect(() => resolveAiConfig({ provider: "anthropic", anthropicApiKey: "sk-test" })).not.toThrow();
  });
});

// タスク定義「テストで証明すること: AI_PROVIDERを切り替えると、呼ばれる先が
// 変わる（プロバイダは差し替えて確かめる。本物のAPIをテストで叩かない）」。
// buildProviderRequestは実際にfetchしない純粋関数のため、これだけで
// 宛先・認証ヘッダ・モデル名がプロバイダごとに変わることを確認できる
describe("buildProviderRequest（本物のAPIは叩かない）", () => {
  it("openaiとanthropicで宛先URLが異なる", () => {
    const openaiConfig = resolveAiConfig({ provider: "openai", openaiApiKey: "sk-openai" });
    const anthropicConfig = resolveAiConfig({ provider: "anthropic", anthropicApiKey: "sk-anthropic" });

    const openaiRequest = buildProviderRequest(openaiConfig, "テスト本文");
    const anthropicRequest = buildProviderRequest(anthropicConfig, "テスト本文");

    expect(openaiRequest.url).toContain("openai.com");
    expect(anthropicRequest.url).toContain("anthropic.com");
    expect(openaiRequest.url).not.toBe(anthropicRequest.url);
  });

  it("openaiはBearerトークン、anthropicはx-api-keyヘッダで認証する", () => {
    const openaiConfig = resolveAiConfig({ provider: "openai", openaiApiKey: "sk-openai-123" });
    const anthropicConfig = resolveAiConfig({ provider: "anthropic", anthropicApiKey: "sk-anthropic-abc" });

    const openaiRequest = buildProviderRequest(openaiConfig, "テスト本文");
    const anthropicRequest = buildProviderRequest(anthropicConfig, "テスト本文");

    expect(openaiRequest.headers.authorization).toBe("Bearer sk-openai-123");
    expect(anthropicRequest.headers["x-api-key"]).toBe("sk-anthropic-abc");
    // 互いのキーを取り違えて埋め込んでいないこと
    expect(JSON.stringify(openaiRequest.headers)).not.toContain("sk-anthropic-abc");
    expect(JSON.stringify(anthropicRequest.headers)).not.toContain("sk-openai-123");
  });

  it("モデル名は環境変数から来ない。プロバイダごとの既定値が入る", () => {
    const openaiConfig = resolveAiConfig({ provider: "openai", openaiApiKey: "sk-openai" });
    const anthropicConfig = resolveAiConfig({ provider: "anthropic", anthropicApiKey: "sk-anthropic" });

    const openaiRequest = buildProviderRequest(openaiConfig, "テスト本文") as { body: { model: string } };
    const anthropicRequest = buildProviderRequest(anthropicConfig, "テスト本文") as { body: { model: string } };

    expect(openaiRequest.body.model).toBeTruthy();
    expect(anthropicRequest.body.model).toBeTruthy();
    expect(openaiRequest.body.model).not.toBe(anthropicRequest.body.model);
  });

  // security-auditor指摘（Medium）: Anthropicはmax_tokensを指定していたが
  // OpenAI側に出力の上限が無かった。投稿本文に埋め込んだ指示
  // （プロンプトインジェクション）で出力トークンを膨らませられる経路が
  // あったため、両プロバイダに同じ上限を入れて揃えた
  // fix/ai-summary-max-completion-tokens: OpenAI 側の名前は max_completion_tokens。
  // gpt-5 系は max_tokens を 400（unsupported_parameter）で拒む（本番で AI まとめが
  // 全件失敗していた原因。B が同じ body で再現した）
  it("出力トークンの上限は、OpenAI は max_completion_tokens（max_tokens は送らない）、Anthropic は max_tokens", () => {
    const openaiConfig = resolveAiConfig({ provider: "openai", openaiApiKey: "sk-openai" });
    const anthropicConfig = resolveAiConfig({ provider: "anthropic", anthropicApiKey: "sk-anthropic" });

    const openaiRequest = buildProviderRequest(openaiConfig, "テスト本文") as {
      body: { max_completion_tokens?: number; max_tokens?: number };
    };
    const anthropicRequest = buildProviderRequest(anthropicConfig, "テスト本文") as {
      body: { max_completion_tokens?: number; max_tokens?: number };
    };

    expect(openaiRequest.body.max_completion_tokens).toBeGreaterThan(0);
    expect(openaiRequest.body).not.toHaveProperty("max_tokens");
    expect(anthropicRequest.body.max_tokens).toBeGreaterThan(0);
    expect(anthropicRequest.body).not.toHaveProperty("max_completion_tokens");
  });

  it("投稿本文がリクエスト本文に入る（画像・利用者名・IDは渡していない）", () => {
    const config = resolveAiConfig({ provider: "openai", openaiApiKey: "sk-openai" });
    const request = buildProviderRequest(config, "会いたい気持ちを書いた投稿") as {
      body: { messages: { content: string }[] };
    };
    const serialized = JSON.stringify(request.body);
    expect(serialized).toContain("会いたい気持ちを書いた投稿");
  });
});

// fix/ai-summary-max-completion-tokens: !response.ok のとき、status だけでなく
// プロバイダのエラー本文の先頭がサーバログ（withErrorId が console.error に渡す
// Error の message）に残る。status だけでは原因を当てられなかった。
// クライアントには出ない（withErrorId が ID だけを返す。そちらは error-id の
// 既存テストが固定している）
describe("generateSummary: プロバイダが失敗したときのエラー本文（fetch は差し替える）", () => {
  const env = { provider: "openai", openaiApiKey: "sk-openai-secret-key" };
  const entries: PostEntry[] = [
    { label: "A", body: "投稿1" },
    { label: "B", body: "投稿2" },
  ];

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("status とエラー本文の先頭が Error の message に入り、API キーは入らない", async () => {
    const providerBody = JSON.stringify({
      error: {
        message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
        type: "invalid_request_error",
        param: "max_tokens",
        code: "unsupported_parameter",
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(providerBody, { status: 400 })));

    await expect(generateSummary(env, entries)).rejects.toThrow(/openai 400: .*max_completion_tokens/);
    await expect(generateSummary(env, entries)).rejects.not.toThrow(/sk-openai-secret-key/);
  });

  it("本文は改行を潰して先頭 200 文字に切る", async () => {
    const longBody = "x".repeat(500) + "\n" + "y".repeat(500);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(longBody, { status: 502 })));

    const error = await generateSummary(env, entries).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    const head = (error as Error).message.split("openai 502: ")[1] ?? "";
    expect(head.replace(/）$/, "")).toHaveLength(200);
    expect((error as Error).message).not.toContain("\n");
  });

  it("本文が読めなくても status は残り、落ちない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const response = new Response("ignored", { status: 500 });
        // text() が例外を投げる応答を作る
        response.text = async () => {
          throw new Error("stream broken");
        };
        return response;
      }),
    );

    await expect(generateSummary(env, entries)).rejects.toThrow(/openai 500: \(本文を読めませんでした\)/);
  });
});

// タスク定義5節: その月の投稿本文の合計を8000文字で切る。超えたら古い方から落とす
describe("buildPrompt", () => {
  it("合計が上限以内ならそのまま全部含む", () => {
    const entries: PostEntry[] = [
      { label: "A", body: "古い投稿" },
      { label: "B", body: "新しい投稿" },
    ];
    const prompt = buildPrompt(entries);
    expect(prompt).toContain("古い投稿");
    expect(prompt).toContain("新しい投稿");
  });

  // 人間の指摘: AIがどちらの投稿者かを区別できた方がよいが、実名は渡さない
  // （タスク定義8節）。couple_membersのslotから機械的に決まる記号（A/B）だけを
  // 渡す
  it("投稿ごとにA/Bの記号が付く（実名は渡さない）", () => {
    const entries: PostEntry[] = [
      { label: "A", body: "わたしの投稿" },
      { label: "B", body: "相手の投稿" },
    ];
    const prompt = buildPrompt(entries);
    expect(prompt).toContain("A: わたしの投稿");
    expect(prompt).toContain("B: 相手の投稿");
  });

  it("合計が上限を超えたら、古い方（配列の先頭）から落とす", () => {
    const old1: PostEntry = { label: "A", body: "old1".repeat(1995) }; // ラベル込みで8000文字程度
    const old2: PostEntry = { label: "B", body: "old2".repeat(100) };
    const newest: PostEntry = { label: "A", body: "newest".repeat(100) };
    const prompt = buildPrompt([old1, old2, newest]);

    // 上限を超えるため何かが落ちているはずで、最新のものは必ず残る
    expect(prompt.length).toBeLessThanOrEqual(MAX_INPUT_CHARS);
    expect(prompt).toContain(newest.body);
    // 一番古いものから落ちる（old1が真っ先に落ち、old2より先に消える）
    expect(prompt).not.toContain(old1.body);
  });

  it("1件だけで上限を超える場合、新しい方からMAX_INPUT_CHARS文字だけ残す", () => {
    const single: PostEntry = { label: "A", body: "a".repeat(MAX_INPUT_CHARS + 500) };
    const prompt = buildPrompt([single]);
    const formatted = `A: ${single.body}`;
    expect(prompt.length).toBe(MAX_INPUT_CHARS);
    // 末尾（新しい側）を残す
    expect(prompt).toBe(formatted.slice(formatted.length - MAX_INPUT_CHARS));
  });

  it("空配列なら空文字を返す", () => {
    expect(buildPrompt([])).toBe("");
  });
});
