import { applyD1Migrations, env } from "cloudflare:test";
import { vi } from "vitest";

// vitest.config.ts の TEST_MIGRATIONS バインディング経由で渡されたマイグレーションを
// テスト用D1に適用する（自動適用されないため、テスト実行前に毎回明示的に行う）
await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS);

// 037・security-auditor指摘: lib/ai.tsのgenerateSummaryはグローバルのfetchを
// 直接呼ぶ。テストがfetchの差し替え（vi.stubGlobal）を忘れると、本物の
// 外部APIへ静かに到達してしまう（実際にOpenAIへ本物のリクエストが飛んだ
// 事故があった。ai-summary.test.tsのコメント参照）。既定のfetchを
// 「呼ばれたら例外」に固定し、差し替えを忘れたテストは即座に失敗させる
// （「本物のAPIを叩かない」を規約ではなく仕組みで担保する。差し替えが
// 必要なテストは自分でvi.stubGlobal("fetch", ...)し、afterEachで
// vi.unstubAllGlobals()すればこの既定に戻る）
vi.stubGlobal("fetch", () => {
  throw new Error("fetchが差し替えられていません。テストが本物のAPIを叩こうとしています");
});
