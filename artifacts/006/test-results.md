# 006: 投稿スキーマとAPI — テスト結果

実行日: 2026-08-29 / セッションB

## `pnpm type-check`

全ワークスペースで通過（exit 0）。

```
packages/db type-check: Done
packages/contract type-check: Done
packages/ui type-check: Done
apps/app type-check: Done
apps/api type-check: Done
```

## `pnpm lint`

`eslint .` エラーなし。

## `pnpm test`（`apps/api` の Vitest + Miniflare）

```
apps/api test:  Test Files  8 passed (8)
apps/api test:       Tests  90 passed (90)
```

内訳（新規/変更ファイル）:

- `apps/api/test/post.test.ts`（新規） — `post.create`/`post.list`/`post.delete` の単体〜結合テスト
  - 作成・一覧・削除の基本動作
  - 画像情報（imageKey/imageWidth/imageHeight）を受け取って保存するだけであること（007でアップロード実装）
  - 本文2000文字ちょうどは通過、2001文字は入力バリデーションで拒否
  - 論理削除された投稿が一覧に出ないこと
  - 他ペアの投稿が一覧に混ざらないこと
  - **同一秒に複数投稿してもページングで重複・欠落しない**（19件の異なる秒 + 20〜22位を同一秒にして
    ページ境界に同一秒のタイをまたがせ、複合カーソル `(created_at, id)` で正しく分割されることを確認）
  - 壊れた cursor が `INVALID_INPUT` になること
  - 未認証 `FORBIDDEN` / 未所属 `NEEDS_ONBOARDING`
  - 他ペアの投稿ID指定・存在しないID・削除済みIDがいずれも `NOT_FOUND` になり、対象が変化しないこと
- `apps/api/test/authorization.test.ts`（変更） — `security-requirements.md` 3節の5項目チェックリストに
  `post.list`/`post.create`/`post.delete` を追加
  - 1. ペアAがペアBの投稿を取得・削除できないこと
  - 2. 未認証での書き込み（`post.create`/`post.delete`）が `DEMO_COUPLE_ID` 設定有無に関わらず `FORBIDDEN`
  - 3. 未認証で読み取れるのが `post.list` でもデモペアの投稿のみであること
  - 4. 未所属ユーザーが `post.list`/`post.create`/`post.delete` を呼ぶと `NEEDS_ONBOARDING`
  - 「認可の基底を経由しない手続きが無い」の実在数チェックを 7→10 に更新（health.get/me.get + couple 3 + invite 2 + post 3）
  - 既存の005由来のテスト（couple/invite）はすべて維持され緑

## 実装メモ（設計判断の記録）

- **`post.list` の `limit` はサーバ側で20件固定**にした。`architecture.md` 5節の手続きシグネチャ
  `post.list { cursor?, limit }` は `limit` をクライアント入力として書いているが、タスク006の
  「実装内容」は「1回20件」とだけ書いており `limit` パラメータへの言及が無い。クライアントに
  任意の件数を許すと過大な一括取得（DoSに近い挙動）の経路になるため、固定20件のみを実装した
  （`conventions.md` 9節「引用側が広い」特殊化に該当すると判断）
- カーソルは `{ createdAt, id }` を `btoa(JSON.stringify(...))` で不透明な文字列にエンコードした。
  Cloudflare Workers は `nodejs_compat` が有効だが、`btoa`/`atob` は Workers 標準APIとして
  常に使えるため、値がASCII範囲（数値とUUID文字列）に収まるこの用途ではそれで十分と判断した
- `post.delete` の戻り値は `{ id }` のみとした。architecture.md 5節に出力型の明記が無いため、
  `couple`/`invite` の「削除対象を確認できる最小限の値を返す」慣習に合わせた
