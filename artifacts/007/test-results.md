# 007 テスト結果

2026-08-29 実行。`pnpm run type-check` / `pnpm run lint` / `pnpm run test`（すべてルートから）。

## 結果サマリ

| パッケージ | 結果 |
|---|---|
| `packages/contract` type-check | 通過 |
| `packages/db` type-check | 通過 |
| `packages/ui` type-check | 通過 |
| `apps/api` type-check | 通過 |
| `apps/app` type-check | 通過 |
| 全体 lint（eslint .） | 通過 |
| `packages/ui` test | 2 files / 7 tests 全て緑 |
| `apps/app` test | 2 files / 14 tests 全て緑 |
| `apps/api` test | 8 files / 109 tests 全て緑 |

## apps/api テスト内訳（抜粋。007で追加・変更した観点）

- `post.create`: 本文/画像どちらか必須（空・空白のみの2ケース）、画像付き投稿の作成、
  未アップロードのimageId拒否、同じimageIdの2重使用拒否（UNIQUE制約）、
  サイズ超過（8MB超）の拒否+R2削除、Content-Type不一致の拒否+R2削除、
  ULID形式でないimageIdの拒否、**他ペアが置いたimageIdを送っても到達しないこと**
- `post.list`: 画像付き投稿が署名付きGET URLを含むこと
- `post.delete`: 画像付き投稿の削除でR2からもオブジェクトが消えること、
  image_keyがDBに残ること、R2削除失敗時もpost.deleteが成功として返ること
- `post.uploadUrl`: 認証済みメンバーが呼べること、呼ぶたびに異なるimageIdが発行されること、
  image/jpeg以外のcontentTypeが弾かれること、未認証でFORBIDDEN、未所属でNEEDS_ONBOARDING
- `authorization.test.ts`（security-requirements.md 3節の5項目）: post.uploadUrlを
  追加した状態でも5項目すべて緑。「認可の基底を経由しない手続きが無い」の実在数チェックも
  11（007時点）に更新

## apps/app テスト内訳

- `test/image.test.ts`（画像圧縮ユーティリティ）: 長辺1600px超の横長/縦長画像がresizeされること、
  1600px以下はresizeしない（アップスケールしない）こと、JPEG品質0.8で保存すること、
  対応していない形式（gif等）でUnsupportedImageTypeErrorを投げること、
  mimeType未取得時は形式チェックをスキップすること、署名付きURLへの直接PUT、PUT失敗時のエラー
- `test/button.test.tsx`（Buttonの二重発火防止。旧L26）: 同期onPressの二重発火防止、
  非同期onPress解決までの二重発火防止、disabled時に発火しないこと、
  同期onPress例外時にガードが固着しないこと、非同期onPress reject時にガードが固着しないこと

## 実行ログ全文

`artifacts/007/test-results-raw.txt` 参照。

## 未実施（実機確認が必要）

R2のS3互換API認証情報（`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`）が
ローカルの `.dev.vars` に未設定のため、以下は未実施:

- 実際のアップロード前後のファイルサイズ比較
- 署名なしアクセスの拒否確認
- 署名付きURLの期限切れ後のアクセス拒否確認

003のGoogle OAuthクライアントと同じ制約（Cloudflareダッシュボードでの発行が必要）。
詳細は `docs/tasks/007-image-upload.md` の実装メモ、`docs/state.md` の次の一手を参照。
