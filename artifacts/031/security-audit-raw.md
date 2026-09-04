# 031: 1投稿に複数画像 — security-auditorの監査（生ログ）

対象: `apps/api/src/procedures/post.ts` / `memory.ts` / `me.ts` / `stats.ts`、
`packages/contract/src/post.ts` / `memory.ts`、
`packages/db/migrations/0019_post_images.sql`、
`packages/db/src/schema/post.ts`、`apps/app/app/compose.tsx`、
`apps/app/components/post-images.tsx` / `image-viewer.tsx` / `post-card.tsx`、
`apps/app/lib/image.ts`、`apps/api/src/lib/r2-signed-url.ts`

**High の指摘はありません。**水平権限昇格（T1）・デモ経路（T4/T5）・
画像キーの受け取り（architecture.md 5節）の3点については、経路を追った
限り破れていません。Medium 2件・Low 5件。

## Medium

1. **`post.delete`の`post_images`削除EXISTS句を固定するテストが無かった。**
   実装自体は正しい（他ペアを弾く）が、このガードを消しても緑のまま通る
   状態だった → `apps/api/test/post.test.ts`「他ペアの投稿IDを指定すると
   NOT_FOUND」テストに画像付き投稿と`post_images`/R2実体の確認を追加して
   固定した（**対応済み**）
2. **孤児オブジェクトの回収手順ドキュメントが`posts.image_key`を参照した
   まま、実装（031で物理削除に変更）と食い違っていた。**
   `architecture.md`6節・`security-requirements.md`5節を、
   `post_images.key`ベースの回収手順に書き換えた（**対応済み**）

## Low

1. **`post.delete`のEXISTS句に`deleted_at IS NULL`が無い。** 既に論理削除
   済みの投稿を再度指定すると、UPDATE は0件でNOT_FOUNDになる一方
   `post_images`のDELETEだけが成立しうる（031移行で旧設計の削除済み投稿が
   画像付きのまま残っていた場合）→ **`0019_post_images.sql`のINSERT SELECTに
   `deleted_at IS NULL`を追加し、論理削除済みの投稿の画像はそもそも
   `post_images`へ移さない形にして対応**（EXISTS句へ`deleted_at IS NULL`を
   足す案は、`post.delete`の`UPDATE`が同じbatch内で先に`deleted_at`を
   立てるため、通常の削除フロー自体を壊すことが分かり採用しなかった）。
   `migration-existing-rows.test.ts`に、削除済み投稿の画像が移らないことを
   固定するテストを追加した
2. **`bucket.head`/`bucket.delete`の例外がそのまま投げられ、画像キーが
   ログに出うる。** 024でme.tsに対して行った修正と同じ形の再発。031で
   head呼び出しが最大4回に増え、当たる確率も上がった →
   **`post.ts`のpostCreateで、両方の呼び出しを鍵を含まない汎用メッセージへ
   詰め替えるtry/catchで包んだ（対応済み）**
3. **署名付きURL発行のたびに新しい`AwsClient`を生成しており、SigV4の鍵導出
   （HMAC 4連鎖）がキャッシュされない。** `post.list`が1リクエストで最大
   80件（20件×4枚）まで発行しうるようになり、未認証のデモ閲覧からも
   到達する → **`r2-signed-url.ts`にモジュールスコープの`AwsClient`
   キャッシュを追加した（対応済み）**
4. **`0019_post_images.sql`のINSERT SELECTが、旧`image_width`/
   `image_height`（NULL許容）のNULLを想定しておらず、`post_images`の
   NOT NULL制約違反でリモート適用が失敗しうる。** →
   **`scripts/check-remote-migration-preconditions.mjs`に、0013と同じ
   fail-closedの前提条件チェックを追加した（対応済み）。件数が0件でなければ
   デプロイを止め、人間の是正を要求する**
5. **compose.tsxの複数枚並列アップロードで、`post.create`が失敗すると
   最大4倍の孤児オブジェクトが残りうる。** 機密性ではなく容量・費用の問題で、
   既存の受け入れ範囲内の判断（`architecture.md`6節）。上記の回収手順
   一本化（Medium-2の対応）で同じ走査により兼ねられるため、追加対応は
   見送った（**記録のみ**）

## 確認して問題が無かった点（指摘なし）

- 認可（他ペアのimageId）: `imageKeyFor(ctx.coupleId, imageId)`で鍵を組み立て、
  手続きの引数にcoupleIdも鍵も現れない
- パストラバーサル: `IMAGE_ID_PATTERN`（ULID文字集合）で構造的に閉じている
- 枚数の上限: Zodの`.max(4)`がサーバ側でBAD_REQUESTとして効き、`position`は
  DB側でも複合主キー＋CHECKで二重に押さえている
- 途中失敗時の一貫性: 全枚数の実体確認をDBに1行も書く前に済ませ、
  posts/post_imagesのINSERTを1本の`db.batch()`にまとめている
- UNIQUE制約と重複imageId: 同一リクエスト内・別投稿間のどちらも
  `post_images_key_unique`違反でINVALID_INPUTになる
- `me.delete`: `post_images`の削除文が`posts`より前・`reactions`の後に入り、
  自ペアに閉じている
- `stats.photoCount`: `couple_id`と`deleted_at IS NULL`の両方を含むJOIN
- `memory.get`: 4段の探索すべてに`deleted_at IS NULL`があり、画像取得は
  絞り込み済みのpost_id経由
- T9（クライアントキャッシュ）: 新しいキャッシュキーを導入していない
- ログ: 031で追加されたコードに画像キー・本文の出力は無い

## 補足（セキュリティ指摘ではない）

- `post.create`の戻り値は`body: input.body`（未trim）を返す一方、DBへは
  `trimmedBody`を保存している。投稿直後の表示と再取得後の表示が食い違う
  （整合性の問題。007以前からの既存の挙動で、031で新規に作ったものではない
  ため今回は変更していない）
- `post_images`を読む3箇所は`couple_id`列を持たない表を`post_id`経由で
  間接的にスコープしている。現状の呼び出し元は全て`couple_id`で絞った
  クエリの結果を渡しており安全だが、将来クライアント由来の`postId`を
  受ける手続きが増えたときに備え、`posts`へのJOINで`couple_id`を明示する
  形にしておくとよい（設計メモとして記録。今回は変更していない）
