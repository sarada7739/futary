# 066: 依存の既知脆弱性に追随する（undici・brace-expansion・hono）と、Dependabot の失敗を止める

## 目的

**人間の問い（2026-10-02）。** GitHub の Actions に、Claude で作業していない間も `Dependabot Updates` の失敗（赤）が並ぶ（09-26〜09-30 に 10 回。`undici` 9 回・`image-size` 1 回）。

A が調べた（2026-10-02）:

- **失敗の正体**: Dependabot のセキュリティ更新（リポジトリの設定で有効。勧告が出ると自動で PR を作ろうとする）が、**上げられずに `security_update_not_possible` で終わっている**。
  - `undici`: 修正版は 7.29.1・8.10.2。だが `miniflare@5.20260825.0-alpha`（`wrangler` の中）が `undici` を **7.29.0 で固定**して宣言しているので、Dependabot は推移的依存を上げられない（ログ: 「The latest possible version of undici that can be installed is 7.29.0 / The earliest fixed version is 7.29.1」）
  - `image-size`: `metro@0.87` が `^1.0.2` を宣言（修正版は 2.0.3）。これは無視リストに入れてある（`security-requirements.md` 9節）
- **`pnpm audit` の今**: high 9・moderate 16・low 6。**high は `undici`（7 件）と `brace-expansion`（2 件）**。最後の main の CI（09-26）は緑だが、**次に CI が走ると「high 以上で赤」の段で落ちる**
- `hono`（**Worker の本番依存**）に moderate 1 件（GHSA-hxh3-vqpv-xpqv。修正 4.13.7。宣言 `^4.13.5` の範囲内）

## 0. 決めたこと（A）

| # | 何 | 決定 | 理由 |
|---|---|---|---|
| 1 | `undici@7`（miniflare 経由） | **`wrangler` を最新（4.146.0。`miniflare@5.20261001.0-alpha` が `undici 7.29.1`・`sharp 0.35.4` を宣言）へ上げる。`@cloudflare/vitest-plugin` も `^1.3.4` へ**（1.1.0 は古い miniflare と wrangler を自分で持っていて、wrangler だけでは high が消えない）。**`@cloudflare/workers-types` を `^5.20261001.1` へ**（wrangler 4.146.0 の peer。`packages/db`）。override は使わない | 親を上げれば直る。開発時（`wrangler dev`・テスト）のみで、Worker には含まれない |
| 2 | `undici@8`（jsdom 経由） | **`jsdom` を 30.1.1（`undici ^8.10.2`）へ**（`apps/app` の devDependencies） | 同上。テストのみ |
| 3 | `brace-expansion`（`minimatch@10.2.6` 経由） | まず `pnpm update -r --depth=Infinity brace-expansion minimatch` で上がるか試す。**上がらなければ override `"brace-expansion@>=4 <5.0.12": "5.0.12"`**（既存の `sharp`・`js-yaml` と同じ書き方。経路・到達可能性・消す条件のコメント付き） | 9節 T7: 修正版がある勧告は無視リストに入れず上げる |
| 4 | `hono` | **`^4.13.7` 以上に**（lockfile を 4.13.12 まで）。**本番の Worker に入るので、`pnpm -r test` に加え `wrangler dev` で `/` と `/app/` とログインの往復を確かめる** | 本番依存。moderate でも上げる |
| 5 | `sharp` の override | **消す**（コメントの条件「miniflare が sharp>=0.35.4 を宣言する版」を #1 で満たす）。消した後に `sharp` が 0.35.4 以上であることを lockfile で確かめる | 条件を満たした override を残さない |
| 6 | `image-size` の Dependabot の失敗 | **`.github/dependabot.yml` を置き、`image-size` を `ignore` にする**（`package-ecosystem: npm`・`directory: /`・`schedule: weekly`・**`open-pull-requests-limit: 0`**（通常の版の更新は作らない。セキュリティ更新だけ、の方針のまま）・`ignore: [{dependency-name: "image-size"}]`。理由と消す条件（metro が `^2` を宣言したら）をコメントに） | 上げられないと分かっているものを毎日失敗させない。無視リスト（audit）と同じ扱いを Dependabot にも |
| 7 | 残る moderate（esbuild・uuid・decode-uri-component・fflate） | **この 066 では触らない。** fflate は Dependabot の PR（#340・#382）が開いたまま（別に判断する） | 範囲を広げない。high と本番依存を先に |
| 8 | 失敗した Dependabot の実行の記録 | 消さない（GitHub に残るだけで害は無い） | |

## 1. B の作業

- `apps/api/package.json`: `wrangler` を最新・`@cloudflare/vitest-plugin` を `^1.3.4`・`hono` を `^4.13.7` 以上。`packages/db/package.json`: `@cloudflare/workers-types` を `^5.20261001.1`。`apps/app/package.json`: `jsdom` を 30.1.1。lockfile を更新
- `pnpm-workspace.yaml`: `sharp` の override を消す。必要なら `brace-expansion` の override を足す（0節 #3）
- `.github/dependabot.yml`（0節 #6）
- `pnpm audit` の前後（high・moderate・low の数）を `artifacts/066/stage1.md` に

## 2. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | `pnpm audit --audit-level=high` が緑（`node scripts/pnpm-audit.mjs --audit-level=high`）。陳腐化の検出も緑（`image-size` の 2 件が出る。出ないときは再実行。9節） | CI |
| T2 | lockfile に `undici@7.29.0`・`undici@8.10.0`・`hono@4.13.5`〜`4.13.6` が無い。`sharp` は 0.35.4 以上 | 報告（`grep`） |
| T3 | `pnpm -r test`・型チェック・lint が緑（件数が前と同じ） | CI |
| T4 | `wrangler dev` で `/`・`/app/`・ログインの往復・投稿 1 件（hono と wrangler を上げたので、Worker が今まで通り動く） | 報告 |

## 完了条件

- T1〜T4
- デプロイ後、次の Dependabot の実行で `undici` の失敗が出ない（人間が Actions を見る。出たら A へ）
- `security-requirements.md` 9節（Dependabot の行・override の扱い）は A が直した
- `state.md` / `worklog.md`

## 停止条件

- `wrangler` を上げて `wrangler dev`・テストが壊れる（miniflare の alpha の変更）→ 上げずに `"undici@7": "7.29.1"` の override に切り替えてよい。理由を報告に
- `hono` を上げて API の振る舞いが変わる（テストが落ちる）→ A へ
- レビュー往復 3 回 → A へ

## 順序

**すぐ（最優先）。**次の PR の CI が赤になる前に。iOS 段階0・メール認証の前。
