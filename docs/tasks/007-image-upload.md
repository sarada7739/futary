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

### 前提: `apps/app` にテスト基盤を用意する（このタスクで導入する）

**`apps/app` にはテストが1件も無い。** M1 の実機確認で見つかった2件
（`callbackURL` の相対パス、ボタンの二重発火）は手で触って初めて分かったもので、
**退行しても誰も気づけない**（旧 L27）。

006 までは全てサーバ側で、既存の API テスト基盤で足りていた。
**クライアント側のロジックが最初に出るのがこのタスク（画像圧縮）**なので、ここで入れる。

- Vitest + React Native Testing Library を `apps/app` に導入する
- CI（`.github/workflows/ci.yml`）で実行されるようにする
- このタスクで**最低2件**書く
  1. 画像圧縮のユーティリティ（長辺と品質の適用、非対応形式の扱い）
  2. **`Button` を素早く2回押しても `onPress` が1回しか走らないこと**
     （`conventions.md` 4節。旧 L26。この回帰テストが無いと同じ不具合が戻る）
- URL を組み立てる箇所があれば、**絶対URLになることをテストする**
  （`callbackURL` の相対パス問題と同じ形）

Playwright による E2E はこのタスクで入れない。
認証が Google OAuth のため自動化が重い。**014 のデモ経路は未認証で E2E しやすい**ので、
そちらで導入する（`conventions.md` 6節の E2E 規定はそのタイミングで満たす）。

### 本体

- **`post.create` に「本文か画像のどちらかは必須」を入れる**（旧 L30）
  - `body` を trim した結果が空で、かつ `imageKey` も無いなら `INVALID_INPUT`
  - 006 の時点では画像が無かったため下限が無く、**両方空の投稿を作れる状態だった**
  - 画像が入るこのタスクで、両方空を弾く形に揃える
  - 空白のみの本文も空として扱う。テストで両方空・空白のみの2ケースを検証する
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
- [ ] `apps/app` にテスト基盤があり、CI で実行される
- [ ] `Button` の二重発火を防ぐ回帰テストが緑（`conventions.md` 4節）
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
- [ ] `post.create` の「本文か画像のどちらかは必須」（旧 L30）
- [ ] `apps/app` のテスト基盤導入（Vitest + RNTL、CI 連携）
- [ ] `Button` の二重発火ガードと回帰テスト
- [ ] R2 バインディング設定
- [ ] `post.uploadUrl`（署名付きPUT・5分・contentType検証）
- [ ] クライアント側の圧縮（1600px / 0.8）
- [ ] `post.list` に署名付きGET URL（1時間）
- [ ] `post.delete` で R2 オブジェクト削除
- [ ] 署名なしアクセスの拒否確認
- [ ] security-auditor 実行
- [ ] 証跡保存 → `state.md` 更新 → `worklog.md` 追記
