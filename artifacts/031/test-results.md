# 031: 1投稿に複数画像 — テスト結果

## マイグレーション（`packages/db/migrations/0019_post_images.sql`）

**手順の順序をローカルD1で実測してから書いた**（タスク定義4節「『通るはずだ』で
進めない」）。

1. `CREATE TABLE post_images`
2. `INSERT INTO post_images SELECT ...`（既存の1枚を`position=0`へ）
3. `DROP INDEX posts_image_key_unique`
4. `ALTER TABLE posts DROP COLUMN image_key` / `image_width` / `image_height`

`apps/api/test/migration-existing-rows.test.ts`に2件追加し、実測で固定した:

- **「3を飛ばすと4が落ちる」を実測**: `posts_image_key_unique`が残ったまま
  `image_key`を`DROP COLUMN`すると失敗し、`DROP INDEX`後は成功することを、
  ローカルD1（`cloudflare:test`のD1エミュレータ）で実際に確かめた
  （手順の根拠。023の`couples`と同じ形）
- **既存の1枚が`position=0`へ移る**: `posts`に0018時点の構造
  （`image_key`/`image_width`/`image_height`列＋UNIQUE索引）を一時的に
  再現し、行を入れた状態で本物の0019 SQLを適用。`post_images`へ
  `position=0`・元の`image_key`/`width`/`height`のまま移り、`posts`側の
  3列が消えることを確認した

`packages/db/src/schema/post.ts`のdrizzleスキーマから`pnpm generate`した
結果が「No schema changes」になることを確認済み（手書きした
`packages/db/migrations/meta/0019_snapshot.json`・`_journal.json`が
drizzle-kit自身の生成結果と完全に一致する）。

`schema-integrity.test.ts`に追加:
- `post_images_position_range_check`（名前付きCHECK）が存在する
- `post_images_key_unique`が`key`列のUNIQUEインデックスのままである
- 索引一覧に`post_images_key_unique`が入り、`posts_image_key_unique`が
  消えている

**リモートD1への適用前の件数記録**（`scripts/check-remote-migration-
preconditions.mjs`に追加。0015の記録と同じ形）: `posts.image_key IS NOT
NULL`の件数を、0019適用直前にデプロイジョブのログへ出力するようにした
（`docs/architecture.md`4節「行を消すマイグレーションは、当てる前に件数を
数えて記録する」と同じ理由。列は消えるが、行はpost_imagesへ形を変えて残る）。
**この件数を`worklog.md`へ写すのはマージした者の担当**（本番のデプロイが
実行されるまで確定しない。0015のinvite_failuresと同じ運用）。

## 契約（`packages/contract/src/post.ts`・`memory.ts`）

```
post.create   { body, images?: [{ imageId, width, height }] }   最大4件
post.list     items[].images: [{ url, width, height }]          署名付きGET
post.uploadUrl { contentType } -> { imageId, url }              変えない（枚数ぶん呼ぶ）
```

- `imageUrl`/`imageWidth`/`imageHeight`（単数）を`postSchema`・
  `memoryPostSchema`の両方から削除した
- `images`は`z.array(...).max(4)`。5件渡すとZodで弾かれ`BAD_REQUEST`になる
  （`conventions.md`5節「入力だけで判定できることはZodに置く」）
- `MAX_POST_IMAGES`（=4）を契約からexportし、クライアント（compose.tsx）と
  枚数の上限を1箇所で共有する

## サーバ側（`apps/api/src/procedures/post.ts`）

- `post.list`: `post_images`をpost_idのIN句でまとめて1クエリ取得し
  （`fetchReactionSummaries`と同じN+1回避の形）、`position`昇順のまま
  `images`配列を組み立てる。1リクエストあたり「投稿一覧1・リアクション
  集計1・画像一覧1」の計3クエリで、投稿件数が増えても変わらないことを
  `reaction.test.ts`のprepare呼び出し回数テストで確認（既存の「2クエリ」を
  「3クエリ」に更新）
- `post.create`: **DBに1行も書く前に、`images`の全imageIdについてR2に
  実体があることを確認する**（1枚でも欠けていれば投稿ごと拒む。タスク定義
  5節）。`posts`のINSERTと`post_images`のINSERT（枚数ぶん）を1本の
  `db.batch()`にまとめ、`post_images.key`のUNIQUE違反（同じimageIdの
  使い回し）はbatch全体を巻き戻す
- `post.delete`: `posts`の論理削除・`reactions`の削除・`post_images`の
  物理削除（`RETURNING key`でR2削除対象を受け取る）を1本の`batch()`に
  まとめた。`post_images`は論理削除を持たせない（行が残ると`key`のUNIQUEが
  空きを塞ぐ。タスク定義6節）。R2の削除は枚数ぶんまとめて`bucket.delete
  (keys[])`で試み、失敗しても`post.delete`自体は成功として返す
  （孤児オブジェクトとして受け入れる。architecture.md 6節の既定を変えない）

`apps/api/test/post.test.ts`で証明した項目（既存分を032の複数画像形式へ
書き換えたうえで、以下を新規追加）:
- 複数枚（4枚）を渡すと、渡した順にposition 0..3で保存され、その順で返る
- **5枚渡すと拒まれる**（`BAD_REQUEST`）
- imagesが空配列でも、本文が空なら省略時と同じくINVALID_INPUT（undefinedと
  分けない）
- **複数枚のうち1枚でもR2に実体が無ければ、投稿ごと拒まれる**（1枚も
  書かれていないことをDBへ直接SELECTして確認）
- 画像の並び順がpositionのとおりに返る
- **`post.list`に`imageUrl`（単数）が残っていない**（`toHaveProperty`の
  否定で確認）
- 画像付きの投稿を削除すると、枚数ぶんR2のオブジェクトも`post_images`の
  行も消える
- R2の削除に失敗しても`post.delete`は成功として返り、`post_images`の
  行は（DB側が先に確定するため）消える

## `memory.get`（`apps/api/src/procedures/memory.ts`）

`image_key`列が無くなったため、複数あれば画像のある投稿を優先する判定を
`ORDER BY (image_key IS NULL)`から`ORDER BY (NOT EXISTS (SELECT 1 FROM
post_images WHERE post_images.post_id = posts.id))`へ書き換えた。
`memoryPostSchema`も`images`配列に統一。

## `me.delete`への追加（`apps/api/src/procedures/me.ts`）

**3回目**（027 `wishes`・029 `moods`に続き）。`post_images`は`posts`を
参照する側であり、D1はFKを常に強制するため、削除文を足さないと画像付きの
投稿を持つペアはアカウント削除が恒久的に失敗する。`posts`を消す文より
**先**に、`reactions`削除の直後に追加した（起票の時点でタスク定義に
書かれており、今回は踏んでいない）。

`apps/api/test/me.test.ts`に追加した項目:
- 「ペアの全データが消え」テストで`post.create`を複数画像対応の入力形式へ
  更新し、`post_images`が0件になることを確認（`post_images`は`couple_id`
  列を持たないため、機械的走査〈`couple_id`列を持つ全表〉には自動で
  拾われない。`reactions`と同じ理由で手動確認を追加）
- 「別のペアのデータは削除の影響を受けない」テストに、他ペアの
  `post_images`が残ることの確認を追加

## `stats.get`（写真の枚数）

1投稿に複数枚付けられるようになったため、「写真の枚数」は「画像付き投稿の
件数」ではなく「実際の画像枚数」（`post_images`を`posts`にJOINした行数）に
変更した。`stats.test.ts`の`insertPost`ヘルパーを、`post_images`へ
position=0の画像を1枚追加する形に書き換え、既存のテスト（未削除・画像あり
のみを数える）が引き続き通ることを確認した。

## フロントエンド

- `apps/app/app/compose.tsx`: 単一`SourceImage | null`から`SourceImage[]`
  （最大4枚）へ変更。`ImagePicker.launchImageLibraryAsync`を
  `allowsMultipleSelection: true`・`selectionLimit: 残り枚数`にし、
  4枚に達すると「画像を選ぶ」ボタン自体を隠す（省略枠を作らない設計と
  対になる）。サムネイル一覧に個別の「外す」ボタンを追加。
  `post.uploadUrl`は枚数ぶん並行して呼ぶ（`Promise.all`）
- `apps/app/components/image-viewer.tsx`: `imageUrl: string`単数から
  `images: {url,width,height}[]`＋`initialIndex`へ変更。左右のボタン
  （`‹`/`›`。端では無効化・スワイプにしない）と「n / 総数」のカウンター
  を追加。1枚のときはカウンター・左右ボタンを出さない（見え方を変えない）。
  **ブラウザでの実機確認で、backdropのPressableに
  `accessibilityRole="button"`を付けたまま内側に×・‹・›の3つの
  Pressable（同じくbutton）を入れ子にすると、react-native-webが両方を
  実際の`<button>`要素として描画し、ブラウザのコンソールに「buttonが
  buttonを含められない」というDOM構造エラーが出ることを発見した**
  （017の1個のときから存在していたが、複数枚対応で3個に増えて顕在化。
  クリックの挙動自体は壊れないが、backdropから`accessibilityRole`を
  外して解消した）
- `apps/app/components/post-images.tsx`（新規）: 1枚のときは従来どおり
  アスペクト比を保って表示、2枚以上は正方形グリッド（1行2枚）で、奇数枚
  なら最後の1枚を横幅いっぱいにする。`post-card.tsx`・`memory-card.tsx`の
  両方から共通利用し、画像表示・ライトボックスの実装を1箇所に集約した

`apps/app/test/post-card.test.tsx`に追加した項目:
- 2枚以上では各画像に別々のタップ入口ができる（枚数ぶんの
  accessibilityLabel）
- タップした枚数目からライトボックスが開き、カウンターが表示される。
  次へ/前への送りが機能する
- 1枚のときはカウンター・左右ボタンを出さない（既存の見え方を変えない）

`memory-card.test.tsx`・`memory-screen.test.tsx`・`reaction.test.ts`・
`timeline-screen.test.tsx`のPost/MemoryResultモックを`images`配列形式へ
更新した。

## デモシード（`packages/db/seed/demo.ts`）

**1枚・2枚・3枚・4枚の投稿をそれぞれ1件以上**入れた（タスク定義7節）。
投稿グリッドのindex 5→1枚・15→2枚・25→3枚・35→4枚に割り当て、加えて
1ヶ月前マイルストーンに1枚。写真は`MEETUP_PHOTOS`の4枚を使い回し、
`key`（R2オブジェクトキー）は画像ごとに新しく生成する（同じ写真を複数の
投稿・位置で使ってよいが、keyは必ず別。`post_images.key`のUNIQUE制約に沿う）。
乱数は使わない（決定的なindexとカウンターのみ）。

`demo.test.ts`に追加・変更した項目:
- 投稿が30〜50件、うち画像付きは5件（グリッド4件+マイルストーン1件）
- **1枚・2枚・3枚・4枚の投稿がそれぞれ1件以上ある**
- `post_images`のkeyが投稿・位置をまたいで重複しない
- 外部キー順のDELETE文に`post_images`が正しい位置
  （`reactions`の直後・`posts`の前）で含まれる

実際にローカルD1・R2へ`pnpm seed:local`で投入し、`post_images`を
`post_id`でGROUP BYして1・2・3・4件のグループが実在することをSQLで確認した
（下記「Bによるブラウザでの確認」参照）。

## 全体テスト・型チェック・lint

`pnpm -r test`: packages/date 46件・packages/ui 7件・packages/db 27件・
apps/app 216件・apps/api 409件、全て緑。
`pnpm -r type-check`・`pnpm -w eslint .`、両方通過。

## Bによるブラウザでの確認（未認証・デモ経路）

ローカルD1に0019を適用（`pnpm db:migrate:local`）・デモ再投入
（`pnpm seed:local`）後、`wrangler dev` + `expo start --web`でBrowser pane
から確認。

- `post_images`を`post_id`でGROUP BYし、1・2・3・4枚の投稿がそれぞれ
  実在することをSQLで確認（`demo-post-5`=1・`demo-post-15`=2・
  `demo-post-25`=3・`demo-post-35`=4）
- `post.list`のレスポンスに`images`配列が正しい枚数・順序で入っており、
  `imageUrl`（単数）が存在しないことをfetchで直接確認
- 4枚の投稿がタイムラインで正方形2列グリッドとして表示される（1行2枚×2行）
- グリッドの1枚をタップするとライトボックスが開き、「1 / 4」のカウンター、
  左右の送りボタン（‹/›）が表示され、クリックで枚数間を移動できる。
  端（1枚目・4枚目）でボタンが無効化される
- 上記の複数枚対応後、backdropの入れ子button警告が解消されたことを
  DOM（`document.querySelector`の`outerHTML`）で確認
- **画像の実体は表示できない**（ローカル`wrangler dev`のR2バインディングは
  Miniflareのローカルエミュレータだが、署名付きURLは常に実クラウドR2の
  エンドポイントを指すため。既知の制約。`docs/worklog.md` 2026-08-30
  参照。API層（枚数・順序・URLの発行そのもの）とグリッドのレイアウト
  構造は確認済みだが、実際の画像バイト列の表示確認はこの環境では
  できない）

**認証必須の経路（実際に画像を選んで投稿する操作）はB（自動化）では
実機確認ができない**（027以降と同じ制約。Googleログインが必要）。
`artifacts/031/manual-check.md`参照。

## security-auditorの監査

**High以上はゼロ。**Medium 2件・Low 5件、詳細は
`artifacts/031/security-audit-raw.md`参照:

1. Medium: `post.delete`が`post_images`を他ペア分は消さないことを固定する
   テストが無かった → 画像付き投稿・`post_images`/R2実体の確認を追加して
   対応済み
2. Medium: 孤児オブジェクトの回収手順ドキュメント（`architecture.md`6節・
   `security-requirements.md`5節）が、031で物理削除に変わった
   `post_images.key`ではなく旧`posts.image_key`を参照したままだった →
   両ドキュメントを書き換えて対応済み
3. Low: `0019`のマイグレーションが、論理削除済みの投稿の画像も
   `post_images`へ移してしまう経路が理論上あった → INSERT SELECTに
   `deleted_at IS NULL`を追加し、移行テストで固定して対応済み
4. Low: `post.create`の`bucket.head`/`bucket.delete`の例外に画像キーが
   含まれうる状態だった（024で同種の指摘を受けたme.tsの再発） →
   汎用メッセージへ詰め替えるtry/catchで対応済み
5. Low: 署名付きURL発行のたびに`AwsClient`を作り直し、SigV4の鍵導出が
   キャッシュされていなかった（031で1リクエストあたり最大80件まで発行しうる
   ようになった） → モジュールスコープでキャッシュして対応済み
6. Low: `0019`が旧`image_width`/`image_height`（NULL許容）のNULLを想定して
   おらずリモート適用が失敗しうる → `check-remote-migration-
   preconditions.mjs`にfail-closedの前提条件チェックを追加して対応済み
7. Low: compose.tsxの並列アップロード失敗時、孤児オブジェクトが最大4倍に
   なりうる → 容量・費用の問題（既存の受け入れ範囲内）で、Medium-2の
   回収手順一本化で兼ねられるため記録のみ（追加対応なし）

対応後、`pnpm -r test`（全パッケージ緑）・`pnpm -r type-check`・
`pnpm -w eslint .`を再実行し、全て通過することを確認した。
