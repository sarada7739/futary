## 066 #456（6b65433）— R の判定

**受け入れ。必須修正なし。**

R の手元（futary-R、`pnpm install --frozen-lockfile` から）で確かめた:

- **T1**: `node scripts/pnpm-audit.mjs --audit-level=high` 終了コード 0（high 2 は無視リストの image-size だけ）。`pnpm audit --json` の残りは moderate 4（esbuild GHSA-67mh-4wv8-2f99・uuid GHSA-w5hq-g745-h8pq・decode-uri-component GHSA-vcc3-ghjq-m6fr・fflate GHSA-px8p-9vwx-vf98）・low 0。0節 #7 のとおり。hono の勧告は消えた。`check-audit-ignore-staleness.mjs` は「陳腐化なし」
- **T2**: lockfile に `undici@7.29.0`・`undici@8.10.0`・`hono@4.13.5`・`hono@4.13.6`・`sharp@0.35.2`・`@cloudflare/vitest-plugin@1.1.0` は 0 件。あるのは undici 7.29.1・8.11.2、hono 4.13.12、sharp 0.35.4、brace-expansion 5.0.12。miniflare は 5.20260930.0-alpha（vitest-plugin 1.3.4 の中）・5.20261001.0-alpha（wrangler 4.146.0）の 2 つで、どちらも undici 7.29.1・sharp 0.35.4 を宣言
- **T3**: type-check・lint 緑。`pnpm run test` は ui 23・date 68・db 34・app 630・api 783 = 1,538 で全部緑
- **T4**: `build:public` → `db:migrate:local` → `make-session.mjs` → `api-dev`（wrangler 4.146.0）で `check-dev.mjs` 9/9 OK。wrangler のログでも各リクエストの状態コードが報告と同じ（未認証の post.create は 403）
- 0節 #5: sharp の override は消えていて、lockfile の sharp は 0.35.4 だけ。js-yaml の override は残っている
- 0節 #6: `.github/dependabot.yml` は定義の項目どおり（npm・`/`・weekly・`open-pull-requests-limit: 0`・`ignore: image-size`）。コメントの経路は `pnpm why image-size` と auditConfig のコメントに合う
- 定義に無い 2 つ（vitest-plugin・workers-types）は、上げないと T2 が満たせない／wrangler の peer という理由で筋が通る。A が #457 で定義に足している
- `memory.test.ts`: `monthsBefore("2026-10-02", 1)` と `addDays("2026-10-02", -30)` はどちらも 09-02 になり、`oneMonthAgo` が先に当たる。10 日前は 1 ヶ月前（最短 28 日）・半年前・1 年前のどれとも重ならず、`addDays(today, -6)` の境目より前なので「7 日以上前」も満たす。直し方は正しい
- `worklog.md` は追記のみ（削除 0 行）。コミットのトレーラーは `Session: B` と Co-Authored-By が続いている

## 記録（判定に使わない）

1. `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` に `'@cloudflare/vitest-plugin@1.1.0'` が残っている。lockfile にはもう無い（0 件）。報告の「lockfile から消えた版は外した」と食い違う。害は無いが、次に依存を触るときに消してよい
2. `memory.test.ts` のコメント「前の月が 30 日の月のとき 1 ヶ月前と同じ日になる」は、30 日前と 1 ヶ月前が重なる条件をすべて挙げてはいない（例: 平年の 03-30 は 30 日前も 1 ヶ月前も 02-28）。直した 10 日前の方はどの日でも重ならないので、テストは正しい
3. #457（A）も `docs/state.md` の先頭と `worklog.md` の末尾を書き換えている。先にマージした方の後で、もう一方に main を取り込む必要がある

## 私が確かめていないこと

- 本番の Google ログインの往復（Google の画面の先）。人間の手番
- デプロイ後に Dependabot の `undici`・`image-size` の失敗が止まるか（人間が Actions を見る）
- `open-pull-requests-limit: 0` と `ignore` が、GitHub 側でセキュリティ更新にどう効くか（A の設計どおりとして読んだ。挙動は見ていない）
