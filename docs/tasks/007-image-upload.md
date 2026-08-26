# 007: 画像アップロード（R2）

## 目的
投稿に画像1枚を添付できるようにする。
Worker が画像本体を経由しない構成にし、CPU時間とサイズ制限を回避する。

## 変更対象ファイル
- （新規）`apps/api/src/procedures/upload.ts` — `post.uploadUrl`
- （新規）`apps/api/src/lib/r2-signed-url.ts`
- `apps/api/src/procedures/post.ts` — `post.list` の応答に署名付き GET URL を含める
- `apps/api/src/procedures/post.ts` — `post.delete` で R2 オブジェクトも削除する
- （新規）`apps/app/lib/image.ts` — クライアント側の圧縮とアップロード
- `apps/api/wrangler.toml` — R2 バインディング

## 実装内容
- `post.uploadUrl`: `contentType` を受け取り、署名付き PUT URL を返す
  - 有効期限 **5分**
  - `contentType` を `image/jpeg` に限定して検証する
  - サイズ上限を設定する（例: 8MB）
  - キーは `couples/{ctx.coupleId}/posts/{postId}.jpg`。`postId` は ULID または UUID
  - `writeProcedure` の上に載せる（デモからは呼べない）
- クライアント側で圧縮してからアップロードする
  - 長辺 **1600px**、JPEG 品質 **0.8**
  - 圧縮後に署名付き PUT URL へ直接送る。Worker を経由しない
- `post.list` の応答に署名付き GET URL（有効期限 **1時間**）を含める
- `post.delete` で R2 オブジェクトを削除する。孤児オブジェクトを残さない

## セキュリティ上の必須事項
`docs/security-requirements.md` 5節に従う。
- **R2 バケットに公開URL・カスタムドメインを設定しない**
- キーに推測可能な連番を使わない
- 署名付きURLの有効期限を必ず設定する（無期限にしない）

## 確認観点
- 署名なしで R2 のオブジェクトに直接アクセスできないこと
- 署名付きURLが期限切れ後にアクセスできなくなること
- 大きな画像が圧縮されてからアップロードされること（アップロード後のファイルサイズを確認する）
- 投稿を削除したら R2 からもオブジェクトが消えること
- デモモード（未認証）で `post.uploadUrl` が `FORBIDDEN` になること

## 完了条件
- [ ] 画像付きの投稿ができ、一覧に表示される
- [ ] 署名なしアクセスが拒否されることを確認済み
- [ ] 投稿削除で R2 オブジェクトも消える
- [ ] テストが緑。005 の認可テストも緑
- [ ] **security-auditor の指摘で High 以上がゼロ**（画像アップロードを触るタスクのため必須）
- [ ] `artifacts/007/` に証跡（アップロード前後のファイルサイズ、署名なしアクセスの拒否結果）を保存

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション

## 進捗
- [ ] R2 バインディング設定
- [ ] `post.uploadUrl`（署名付きPUT・5分・contentType検証）
- [ ] クライアント側の圧縮（1600px / 0.8）
- [ ] `post.list` に署名付きGET URL（1時間）
- [ ] `post.delete` で R2 オブジェクト削除
- [ ] 署名なしアクセスの拒否確認
- [ ] security-auditor 実行
- [ ] 証跡保存 → `state.md` 更新 → `worklog.md` 追記
