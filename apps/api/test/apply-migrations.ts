import { applyD1Migrations, env } from "cloudflare:test";

// vitest.config.ts の TEST_MIGRATIONS バインディング経由で渡されたマイグレーションを
// テスト用D1に適用する（自動適用されないため、テスト実行前に毎回明示的に行う）
await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS);

// 037・security-auditor指摘: lib/ai.tsのgenerateSummaryはグローバルのfetchを
// 直接呼ぶ。テストがfetchの差し替えを忘れると、本物の外部APIへ静かに
// 到達してしまう（実際にOpenAIへ本物のリクエストが飛んだ事故があった。
// ai-summary.test.tsのコメント参照）。既定のfetchを「呼ばれたら例外」に
// 固定し、差し替えを忘れたテストは即座に失敗させる
// （「本物のAPIを叩かない」を規約ではなく仕組みで担保する）
//
// 【Rレビュー指摘・訂正】ここをvi.stubGlobal("fetch", guard)にしていたが、
// それが事故の再発防止として機能していなかった。vi.stubGlobalは「その
// キーを最初にstubした時点のglobalThis[key]」を復元先として覚える。この
// ファイルはテストファイルごとに一度しか実行されないため、最初にstubされる
// のはここ（guard）ではなく、各テストのbeforeEachが最初にvi.stubGlobalを
// 呼んだ時点になる場合がある。すると復元先は「本物のfetch」のままになり、
// 最初のテストのafterEach（vi.unstubAllGlobals）でguard自体が消えて本物の
// fetchに戻ってしまう。以降、自分でfetchを差し替え忘れたテストはguardに
// 止められず、本物のAPIへ静かに到達する（Rが実測: 23件中guardが止めたのは
// 1件だけで、残り7件は本物のfetchへ到達した）。
//
// 素の代入にすると、vi.stubGlobalが最初に記録する「復元先」はこのguard自身に
// なる（このファイルの実行が各テストのbeforeEachより必ず先に走るため）。
// これでvi.unstubAllGlobalsは常にguardへ戻り、差し替え忘れは常に例外で
// 止まる（apps/api/test/ai-summary.test.tsの「番人が生きていることの確認」
// テストで実測済み）
globalThis.fetch = (() => {
  throw new Error("fetchが差し替えられていません。テストが本物のAPIを叩こうとしています");
}) as typeof fetch;
