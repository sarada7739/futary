import { applyD1Migrations, env } from "cloudflare:test";

// vitest.config.ts の TEST_MIGRATIONS バインディング経由で渡されたマイグレーションを
// テスト用D1に適用する（自動適用されないため、テスト実行前に毎回明示的に行う）
await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS);

// lib/ai.ts の generateSummary はグローバルの fetch を直接呼ぶ。差し替えを忘れたテストが本物の外部 API
// へ静かに届かないよう、既定の fetch を「呼ばれたら例外」に固定する（本物の API を叩かない、を規約では
// なく仕組みで守る。037）。
// vi.stubGlobal ではなく素の代入にする。vi.stubGlobal は最初に stub した時点の値を復元先として覚えるので、
// 各テストの beforeEach が先に stub すると復元先が本物の fetch になり、vi.unstubAllGlobals で番人が消える。
// 素の代入なら復元先はこの番人になる（ai-summary.test.ts の「番人が生きていること」のテストで確かめる）
globalThis.fetch = (() => {
  throw new Error("fetchが差し替えられていません。テストが本物のAPIを叩こうとしています");
}) as typeof fetch;
