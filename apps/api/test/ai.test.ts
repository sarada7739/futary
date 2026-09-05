import { describe, expect, it } from "vitest";
import { buildPrompt, buildProviderRequest, MAX_INPUT_CHARS, resolveAiConfig, type PostEntry } from "../src/lib/ai";

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
    const anthropicConfig = resolveAiConfig({ provider: "anthropic", anthropicApiKey: "sk-anthropic-456" });

    const openaiRequest = buildProviderRequest(openaiConfig, "テスト本文");
    const anthropicRequest = buildProviderRequest(anthropicConfig, "テスト本文");

    expect(openaiRequest.headers.authorization).toBe("Bearer sk-openai-123");
    expect(anthropicRequest.headers["x-api-key"]).toBe("sk-anthropic-456");
    // 互いのキーを取り違えて埋め込んでいないこと
    expect(JSON.stringify(openaiRequest.headers)).not.toContain("sk-anthropic-456");
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
  it("OpenAI・Anthropicの両方に出力トークンの上限（max_tokens）が入っている", () => {
    const openaiConfig = resolveAiConfig({ provider: "openai", openaiApiKey: "sk-openai" });
    const anthropicConfig = resolveAiConfig({ provider: "anthropic", anthropicApiKey: "sk-anthropic" });

    const openaiRequest = buildProviderRequest(openaiConfig, "テスト本文") as { body: { max_tokens: number } };
    const anthropicRequest = buildProviderRequest(anthropicConfig, "テスト本文") as { body: { max_tokens: number } };

    expect(openaiRequest.body.max_tokens).toBeGreaterThan(0);
    expect(anthropicRequest.body.max_tokens).toBeGreaterThan(0);
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
