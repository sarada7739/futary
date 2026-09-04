# 031: 1投稿に複数の画像

## 目的

**1つの投稿に画像を4枚まで付けられるようにする。**

人間の指示。`requirements.md` 5節「スコープ外」から次フェーズへ上げる4つ目。

## 1. 上限は4枚

- **2列のグリッドに収まる。**5枚目から「＋N」の省略が要る。**省略を作らない**
- 保存解像度は長辺1600px のまま。**4枚で約4倍**になるが、無料枠の範囲

## 2. 表示

- **1枚のときは、いまのまま**（アスペクト比を保つ）。**既存の見え方を変えない**
- ~~**2枚以上は正方形にクロップして、1行に2枚**~~ → **033 で横一列に変えた**
- ~~**奇数枚のときは、最後の1枚を横幅いっぱいにする**~~ → 同上

**1枚のときの見え方は 033 でも変えていない。**

### ~~ライトボックス（017）は左右の送りにする~~

> **033 で覆した（2026-09-04）。理由が間違っていた。**
> `requirements.md` 5節がスコープ外にしていたのは**ジェスチャライブラリが要る**
> ためで、**ページング付きの `ScrollView` には要らない**（B の指摘）。
> **理由が成り立たないのに、結論だけ残っていた。**
> **ボタンは 033 でも残す**（PC からマウスで見る経路になる）。

~~**スワイプにしない。**ジェスチャライブラリ（`react-native-gesture-handler`）は
`requirements.md` 5節でスコープ外のままである。**この判断を 031 で覆さない。**~~

- 左右のボタンで送る
- **何枚目かを出す**（`1 / 4`）
- **閉じる導線は017のまま3つ持つ**

## 3. データモデル — 子テーブルへ移す

**`posts` に列を足さない。**`image_key2` を作らない。

```
post_images                                     -- 031
  post_id   TEXT    NOT NULL -> posts.id
  position  INTEGER NOT NULL                    -- 0..3。並び順
  key       TEXT    NOT NULL UNIQUE             -- R2 オブジェクトキー
  width     INTEGER NOT NULL
  height    INTEGER NOT NULL
  PRIMARY KEY (post_id, position)
  CONSTRAINT post_images_position_range_check CHECK (position BETWEEN 0 AND 3)
```

- **`key` の UNIQUE を保つ**（`architecture.md` 6節
  「画像の実体と行の対応を1対1に保つ」）。**いまの `posts_image_key_unique` が
  持っていた性質を、移した先で失わない**
- **CHECK に名前を付ける**（`architecture.md` 4節）
- 枚数の上限（4枚）は **`position` の CHECK と主キーで DB 側にも表れる。**
  アプリの条件だけに頼らない

### `me.delete` に `post_images` の削除文を足す

**`post_images` は `posts` を参照する側である。D1 は FK を常に強制する。**

**足さないと、画像付きの投稿を持つペアはアカウント削除が恒久的に失敗する。**
`posts` を消す文より**先に**消す。

027 で `wishes`、029 で `moods` と同じことを書いている
（`architecture.md` 4節「表を足したら、消す手順にも足す」）。**3回目である。**

## 4. マイグレーション — 既存の1枚を移す

`0019_post_images.sql`。**手順の順序が効く。**

1. `CREATE TABLE post_images`
2. `INSERT INTO post_images SELECT id, 0, image_key, image_width, image_height
   FROM posts WHERE image_key IS NOT NULL`
3. **`DROP INDEX posts_image_key_unique`**
4. `ALTER TABLE posts DROP COLUMN image_key` / `image_width` / `image_height`

### 3 を飛ばすと 4 が落ちる

**SQLite は、索引に使われている列を `DROP COLUMN` できない。**

**「通るはずだ」で進めない。ローカル D1 で実測してから書く**
（023 が `couples` で同じことをやっている。**3番目を飛ばすと4番目が落ちることまで
実測した**）。

### 移した件数を数えて記録する

**本番には既に画像付きの投稿がある。**

- **移した件数を数え、`docs/worklog.md` に追記する**（0件でも書く。
  `architecture.md` 4節「行を消すマイグレーションは、当てる前に件数を数えて記録する」
  と同じ理由。**列を消すが、データは移る**）
- **数を出す場所はデプロイのジョブログ、記録する場所は `worklog.md`、
  写すのはマージした者**

### drizzle-kit が対話プロンプトを出したら

**022・023 と同じ手順**（`meta/` のスナップショットと journal を手動生成し、
`pnpm generate` で「No schema changes」を確認する）。
**非対話環境ではリネーム検出のプロンプトに答えられない。**

## 5. 契約

```
post.create   { body, images?: [{ imageId, width, height }] }   最大4件
post.list     items[].images: [{ url, width, height }]          署名付きGET
post.uploadUrl { contentType } -> { imageId, url }              変えない
```

- **`imageUrl` / `imageWidth` / `imageHeight`（単数）を消す。**
  **残さない。**残すと「1枚目だけ見ればいい」経路ができ、**2枚目以降が静かに落ちる**
- **`images` が空配列のときは、無いものとして扱う**（`undefined` と分けない）
- **本文（trim後）と `images` が両方空なら拒む**（いまの性質を変えない）
- **`post.uploadUrl` は枚数ぶん呼ぶ。**並行してよい

### 途中で止まっても、半端な投稿を作らない

- **`images` の全ての `imageId` について、R2 に実体があることを確認してから書く**
  （いまの1枚での性質を、枚数ぶんに広げる）
- **1枚でも欠けていたら、投稿ごと拒む。**部分的に作らない
- **同じ `imageId` が既に使われていたら拒む**（`key` の UNIQUE）

**アップロードだけ済んで投稿にならなかった画像は孤児になる**
（`architecture.md` 6節。**いまと同じ扱い。変えない**）。

## 6. 削除

**投稿は論理削除、画像は R2 から即座に消える**（`requirements.md` 6節）。
**枚数ぶん消す。**

- **`post_images` の行も消す**（論理削除を持たせない。行が残ると
  `key` の UNIQUE が空きを塞ぐ）
- **R2 の削除に失敗しても、行の削除は進める**（`architecture.md` 6節
  「削除の順序と孤児オブジェクト」の既定を変えない）

## 7. デモに入れる

- **複数枚の投稿を入れる。**1枚・2枚・3枚・4枚がそれぞれ1件以上
- 写真は `docs/sample/` の4枚を使う。**キーは投稿ごとに別に生成する**
  （`key` は UNIQUE。同じ写真を別の投稿で使ってよいが、キーは別）
- 決定的に組み立てる（乱数を使わない）

## テストで証明すること
- **既存の1枚が `post_images` の `position=0` へ移る**
  （`migration-existing-rows.test.ts`）
- **`DROP INDEX` を飛ばすと `DROP COLUMN` が落ちる**（実測。手順の根拠）
- `post_images_position_range_check` が DB 側にある（`schema-integrity.test.ts`）
- **5枚渡すと拒まれる**（Zod で弾く。`BAD_REQUEST`。`conventions.md` 5節）
- **1枚でも R2 に実体が無ければ、投稿ごと拒まれる**（1枚も書かれていないこと）
- **本文と `images` が両方空なら拒まれる**（既存の性質。**変わらないことを確かめる**）
- **他ペアの画像キーを渡しても通らない**
- **`post.delete` が枚数ぶんの行と R2 オブジェクトを消す**
- **`me.delete` が `post_images` を消す**（画像付きの投稿を持つペアで削除が通ること）
- **並び順が `position` のとおりに返る**
- `post.list` に `imageUrl`（単数）が残っていない

## 確認観点
- **1枚の投稿の見え方が変わっていないか**
- 2〜4枚が読める形で並ぶか
- ライトボックスで**何枚目か分かるか**、**左右に送れるか**
- **投稿の途中で失敗したとき、半端な投稿ができていないか**

## 完了条件
- [ ] 1投稿に4枚まで付けられる
- [ ] 既存の1枚の投稿が、見え方も含めてそのまま残っている
- [ ] ライトボックスで送れる（**スワイプではなく左右のボタン**）
- [ ] `imageUrl`（単数）が契約から消えている
- [ ] 上記のテストが緑
- [ ] 移した件数を `worklog.md` に記録した
- [ ] デモに1〜4枚の投稿が入っている
- [ ] `security-auditor` の監査で High 以上がゼロ
- [ ] `artifacts/031/` に証跡と `manual-check.md` を保存

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション

## 進捗
- [ ] `DROP INDEX` → `DROP COLUMN` の順序をローカル D1 で実測
- [ ] `0019_post_images.sql`・`schema-integrity`・`migration-existing-rows`
- [ ] `me.delete` への追加
- [ ] 契約と `post.*` 手続き
- [ ] 投稿画面（複数選択）・タイムライン（グリッド）・ライトボックス
- [ ] デモシード
- [ ] `security-auditor`
- [ ] 証跡保存 → `state.md` 更新 → `worklog.md` 追記
