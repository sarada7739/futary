# 041: アルバム

## 目的

**人間の指示。写真をアルバムごとにまとめて見られるようにする。**

- **「タイムライン」というアルバムが最初からあり、写真付きの投稿の写真が自動で集まる**
- **アルバムはイベントごとに作れる**（京都旅行・誕生日…）
- **写真をダウンロードできる**（タイムラインの写真も。今は保存する手段が無い）
- 絵は `docs/sample/simpleMode/アルバム機能/モック画面/`（4 枚 + ホームアイコン 1 枚）。
  **モックはホワイトの絵。ピンクは既存の部品に任せる**（3節「ピンクの見え方」）。
  **モックの「アルバムのカラー」は使わない**（人間の指示。色の列を持たない）

**用語**: 人間は「グループ」と呼んだが、モックの画面名が「アルバム」で、ひとつひとつも「新しいアルバム」なので、
**機能名も 1 つ 1 つも「アルバム」**にする。表は `albums`。契約は `album.*`。コードに「group」を使わない。

## 0. 先に決めたこと（A。覆すなら人間が言う）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | アルバムの写真はどこから来るか | **投稿の写真（`post_images`）から選ぶ。アルバム専用のアップロード経路は作らない** | モックのビューアの説明文（日付 + 文章）は投稿本文そのもの。「タイムラインは投稿写真が自動で集まる」と噛み合う。画像の経路が 1 本のまま（`post.uploadUrl` → `post_images`。孤児の回収・退会時の削除・R2 のキー規則を増やさない） |
| 2 | ホームの入口 | **「今日どうだった？」のパネルを「アルバム」に置き換える。9 枚 = 3 列 × 3 行のまま** | 10 枚目を足すと 3+3+3+1 で崩れる。「今日どうだった？」は押しても何も起きない次フェーズの枠（`requirements.md` 5節）。**動くものを出し、動かないものを引っ込める**（`architecture.md` 3節）。次フェーズで作るときに入口を考え直す |
| 3 | ダウンロード | **1 枚ずつ**はこのタスク（ビューアに保存ボタン。タイムラインとアルバムで同じビューアなので両方に効く）。**アルバムをまとめて ZIP は 042**に分ける | 1 枚は署名付き URL に `Content-Disposition: attachment` を付けるだけ（4節）。ZIP はブラウザで組む方式になり、容量の上限・CORS・進捗表示が要る。このタスクに乗せると重い |
| 4 | タイムラインのアルバム | **行を持たない。**`post_images` から毎回引く（仮想） | 自動で集まるものを表に写すと、投稿の作成・削除のたびに同期する経路ができる |
| 5 | 検索窓（モックの上部） | **置かない** | 検索は `requirements.md` 5節でスコープ外。アルバムは 1 ペア 100 件までなので、並べれば見える |
| 6 | ビューアのハート（モック） | **置かない** | リアクションは投稿に付くもの。写真ごとに付け直す機能は作らない |

## 1. データモデル

```sql
CREATE TABLE albums (
  id             TEXT PRIMARY KEY,
  couple_id      TEXT NOT NULL REFERENCES couples(id),
  title          TEXT NOT NULL,                    -- 1〜50 文字（trim 後）
  note           TEXT NOT NULL DEFAULT '',         -- 0〜200 文字
  start_date     TEXT,                             -- YYYY-MM-DD。NULL 可
  end_date       TEXT,                             -- YYYY-MM-DD。NULL 可。start_date が無いと持てない。start_date 以上
  cover_post_id  TEXT,                             -- カバー写真。NULL なら自動（アルバム内でいちばん新しい写真）
  cover_position INTEGER,                          --   post_images の (post_id, position) を指す。FK は張らない（下記）
  created_by     TEXT NOT NULL REFERENCES user(id),-- 返さない（wishes と同じ。両方が触れるので canEdit も無い）
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER                           -- 論理削除
);
CREATE INDEX albums_couple_created_idx ON albums (couple_id, created_at DESC);

CREATE TABLE album_photos (
  album_id  TEXT NOT NULL REFERENCES albums(id),
  post_id   TEXT NOT NULL,
  position  INTEGER NOT NULL,                      -- post_images の (post_id, position)
  added_at  INTEGER NOT NULL,
  PRIMARY KEY (album_id, post_id, position),
  FOREIGN KEY (post_id, position) REFERENCES post_images(post_id, position)
);
CREATE INDEX album_photos_post_idx ON album_photos (post_id, position);
```

- **写真の識別子は `{ postId, position }`**（`post_images` の主キー）。`post_images` に id は無く、足さない
- **`album_photos` は論理削除を持たない。**物理削除する（`post_images` と同じ考え方。`architecture.md` 6節）
- **カバーに FK を張らない。**カバーの写真がアルバムから外れた・投稿が消えたときは、読むときに「アルバム内に無ければ自動」に倒す
  （FK で `SET NULL` にするより、読む側の 1 箇所で倒す方が D1 の `batch()` の順序を気にしなくてよい）
- **`post.delete` は同じ `batch()` で `album_photos` の該当行を消す**（`post_images` を消す前に。FK）。
  **`me.delete` は `album_photos` → `albums` の順に消す**（`architecture.md` 4節「表を足したら、消す手順にも足す」）
- **上限**: アルバムは 1 ペア **100 件**（未削除）。1 アルバムの写真は **500 枚**。超えたら `LIMIT_REACHED`
- **CHECK は持たない**（027・040 と同じ。`end_date >= start_date` は入力スキーマで弾く）
- **タイムライン（仮想）**: `posts.deleted_at IS NULL` の `post_images` 全部。行は持たない（0節 #4）

### 写真の並び順

| | 並び |
|---|---|
| タイムライン | **新しい順**（タイムラインの画面と同じ） |
| アルバム | **古い順**（投稿日時の昇順。旅行の 1 日目が先に来る。アルバムは「出来事を順に見る」もの） |

同じアルバム内でも `posts.created_at` → `post_id` → `position` の順で決める（同秒でも揺れない）。

## 2. 契約（oRPC）

```
PhotoRef  = { postId: string, position: number (0..3) }
Photo     = { postId, position, url, width, height, postedAt (posts.created_at), body (投稿本文。ビューアの説明文) }
Album     = { id, title, note, startDate, endDate, photoCount, cover: { url, width, height } | null, createdAt }
```

| 手続き | 種別 | 入力 | 出力 | 備考 |
|---|---|---|---|---|
| `album.list` | read | `{}` | `{ timeline: { photoCount, previews: Photo[] (最新 4 枚) }, items: Album[] }` | 未削除。**新しい順**（`created_at`）。ページング無し（100 件上限）。**T-viewerKey の対象** |
| `album.get` | read | `{ id }` | `Album` | 他ペア・削除済み・存在しない → `NOT_FOUND` |
| `photo.list` | read | `{ albumId?: string, cursor?, limit }` | `{ items: Photo[], nextCursor }` | **`albumId` 無し = タイムライン**（全投稿写真・新しい順）。あれば そのアルバムの写真（古い順）。`post.list` と同じカーソル方式。`limit` 最大 60。**T-viewerKey の対象** |
| `album.create` | write | `{ title, note?, startDate?, endDate?, fillFromRange?: boolean }` | `Album` | `fillFromRange` が真で `startDate` があれば、**その期間（JST の日の境界。`endDate` 無しなら 1 日）の投稿写真を最初から入れる**。500 枚を超える分は**古い方から 500 枚**（`LIMIT_REACHED` にしない。作れないより入る方がいい。結果の `photoCount` で分かる） |
| `album.update` | write | `{ id, title?, note?, startDate?, endDate?, cover?: PhotoRef \| null }` | `Album` | 渡されなかった項目は変えない。`cover` は**アルバム内の写真**でなければ `INVALID_INPUT`。`null` で自動に戻す。**日付を変えても写真は入れ直さない** |
| `album.addPhotos` | write | `{ id, photos: PhotoRef[] (1〜100) }` | `Album` | **既に入っている分は無視**（同じ要求が 2 回届いても結果が同じ）。自ペアの `post_images` に無い ref は `INVALID_INPUT`。合計が 500 を超えるなら `LIMIT_REACHED`（部分的に入れない） |
| `album.removePhotos` | write | `{ id, photos: PhotoRef[] (1〜100) }` | `Album` | 入っていない分は無視。**投稿の写真は消えない**（アルバムから外すだけ） |
| `album.delete` | write | `{ id }` | `{ id }` | 論理削除 + `album_photos` は物理削除（同じ `batch()`）。**写真は消えない** |
| `photo.downloadUrl` | read | `PhotoRef` | `{ url, filename }` | **`Content-Disposition: attachment` 付きの署名付き GET URL（有効 5 分）**。4節 |

- 他ペアの `id` は `NOT_FOUND`（存在を教えない。`want.*` と同じ）
- `photo.list` は `posts.deleted_at IS NULL` を必ず含める（`architecture.md` 4節）。`album_photos` は `post.delete` で消えるが、それに依存しない
- 署名付き URL は `post.list` と同じ `createGetUrl`。**`album.list` は `previews` 4 枚 + カバー最大 100 枚を署名する。**
  `clientFor` の使い回し（031）があるので CPU は 1 リクエスト 100 署名まで許容する。**超える形（ページ 1 枚で 500 署名）は作らない**
- **`Photo.body` は投稿本文をそのまま返す**（ビューアの説明文。長さで切らない。画面側で 3 行に省略）

## 3. 画面

### 入口: ホームのパネル

**「今日どうだった？」を「アルバム」に置き換える**（0節 #2）。位置はそのまま（2 行目の真ん中。「統計」と「リスト」の間）。
並びを変えない: 変えるのは 1 枚だけで、他の 8 枚の位置を動かさない。

- ラベル「アルバム」
- **ホワイトの写真タイル**: `アルバム機能/モック画面/ホームアイコン/…album_panel….png` を 600×600 JPEG に切り出す（039・040 と同じ置き方）
- **ピンクの線画アイコン**: 既存の `panel-*.png` と同じ線の太さで B が 1 つ作る（重なった写真 2 枚か、アルバムの本）。作れなければ `panel-memory.png` を仮に置いて結果に書く
- `panel-today.png` / 「今日どうだった？」の写真タイルは**消さない**（次フェーズで戻す。参照が無くなるだけ）

### 一覧: `(tabs)/album.tsx`（`href: null`。リスト・ほしいものと同じ）

**モックの絵**: 上にタイムラインの大きなカード、下にアルバムの 2 列グリッド。

```
 ‹  アルバム                        +
┌──────────────────┐ ┌────┐
│ タイムライン  [自動] │ │ 最近 │   ← 左: 最新の 1 枚（大）。右: 次の 3 枚（小）
│ 125 枚            │ │ の 3 │      写真が 4 枚未満なら右の列を空ける（枠を出さない）
└──────────────────┘ └────┘
┌────────┐ ┌────────┐
│ カバー │ │ カバー │
│ 京都旅行 ⋯│ │ 沖縄  ⋯ │   ← 題名・枚数・期間（YYYY/MM）
│ 38枚   │ │ 52枚   │
│ 2026/08│ │ 2026/07│
└────────┘ └────────┘
```

- **タイムラインのカード**: 押すと `/album/timeline`。写真が 0 枚なら「まだ写真がありません」の一文（カードは出す。入口を消さない）
- **アルバムのカード**: カバー（正方形）・題名（1 行省略）・「N 枚」・期間。**期間は `startDate` の年月**（無ければ `createdAt` の年月）。
  カバーが無い（写真 0 枚）なら `surface-tint` の四角（040 と同じ。アイコンも絵文字も置かない）
- **`⋯`**: 「編集」「削除」。削除は確認を挟む（「アルバムを削除しますか？ 写真は消えません」）。**ゲストは `⋯` を出さない**
- **`+`（ヘッダー右）**: 作成モーダル。**FAB にしない**（FAB は投稿のもの。040 と同じ）。ゲストは出さない
- 空: 「イベントごとに写真をまとめられます」（タイムラインのカードの下）

### 作成・編集モーダル

モックの「新しいアルバム」から**カバー写真の選択とカラーを落とした**形。

| 項目 | 必須 | 備考 |
|---|---|---|
| アルバム名 | 必須 | 1〜50 文字。プレースホルダ「例：京都旅行」 |
| 開始日 / 終了日 | 任意 | `date-input8`（既存）。終了日は開始日が無いと入れられない。開始日 > 終了日なら保存できない（理由を 1 行） |
| メモ | 任意 | 0〜200 文字 |
| **この期間の写真を入れる** | — | **作成時だけ**出すトグル。開始日を入れると出る。**初期値は ON**。編集では出さない（2節 `album.update`「写真は入れ直さない」） |

- カバーは作成時に選ばない。**詳細で選ぶ**（下記）。写真が無いアルバムにカバーは選べないため
- 「作成」で閉じて**詳細へ進む**（作ったら次は写真を入れるので）。「編集」の保存は閉じるだけ
- 二重発火は `Button` が防ぐ（`conventions.md` 4節）

### 詳細: `(tabs)/album/[id].tsx`（`href: null`）

`id` が `timeline` ならタイムライン（仮想）。ULID は 26 文字の英数大文字なので衝突しない。
**`(tabs)` の下の動的ルートが `Tabs.Screen` の `href: null` で隠せなければ、`album-detail.tsx` + クエリ `?id=` に倒してよい**
（結果に書く。**`(tabs)` の外に出さない**。`architecture.md` 3節「ボトムタブを消さない」）。

```
 ‹  京都旅行              編集  選択
┌────────────────────────┐
│        カバー（横長）        │
└────────────────────────┘
   2026年8月15日 - 8月17日
   38枚の写真・3日間の思い出
┌──┐┌──┐┌──┐
│  ││  ││  │   ← 3 列の正方形グリッド。押すとビューア
└──┘└──┘└──┘
                         (+)   ← 写真を足す（FAB）。タイムラインには無い
```

- **見出しの 2 行**: 期間（`startDate`〜`endDate`。片方だけなら 1 日。無ければ出さない）と「N枚の写真・M日間の思い出」
  （M = `diffDays + 1`。期間が無ければ「N枚の写真」だけ）。`packages/date` を使う。**日付計算を画面に書かない**（`architecture.md` 5節）
- **`+`（FAB）**: このタスクでは**ここだけ FAB を使う**。投稿の FAB はこの画面に無い（`(tabs)` のタブバーの `＋投稿` は別）。
  押すと**写真を選ぶモーダル**（下記）。**タイムラインには無い**（自動）
- **選択**: 押すと選択モードに入る（ヘッダーが「N 枚を選択中」「やめる」になり、写真にチェックが出る）。
  下に「カバーにする」（**1 枚のときだけ**押せる）「アルバムから外す」。**タイムラインには無い**。
  **長押しにしない**（Web での長押しは安定しない。040 の `⋯` と同じ判断で、ここは選択モードにする）
- **編集**: 作成・編集モーダル（上記）。タイムラインには無い
- **空のアルバム**: 「写真を追加しましょう」+ FAB。カバー領域は `surface-tint` の四角
- ゲスト: 見られる。`+`・選択・編集を出さない

### 写真を選ぶモーダル

- タイムラインの写真（`photo.list`、`albumId` 無し）を 3 列で新しい順に。スクロールで次ページ
- 押すとチェック。**既にアルバムにある写真はチェック済み・押せない**（外すのは詳細の選択モードで）
- 下に「N 枚を追加」。押すと `album.addPhotos`（100 枚ずつに割る。100 枚を超えて選べないようにしてよい。結果に書く）。閉じて詳細へ
- どのアルバムに入っているかは出さない（1 枚が複数のアルバムに入れる。それでいい）

### ビューア（既存の `image-viewer.tsx` を広げる）

**新しいビューアを作らない。**`ImageViewer` に 2 つ足す。

| 足すもの | 中身 |
|---|---|
| `caption?: { title: string; date: string; body: string }` | 画像ごと。下に重ねて出す（モックの左下）。`body` は **3 行で省略**。無ければ何も出さない（**タイムラインの投稿カードからの表示は今のまま**。変えない） |
| `download?: PhotoRef` | 画像ごと。あれば**右下に保存ボタン**。押すと `photo.downloadUrl` → 4節の方法で保存。無ければボタンを出さない |

- **投稿カード（タイムライン）からのビューアにも `download` を渡す**（人間の「タイムラインの写真もダウンロードしたい」）。`caption` は渡さない（本文はカードに見えている）
- アルバムからのビューアは `caption` = { アルバム名（タイムラインなら「タイムライン」）, `postedAt` の日付, `body` }
- 「n / 総数」・閉じる 3 導線・スワイプ・左右ボタンは 033 のまま。**アルバムでは `photo.list` の読み込み済みの範囲を送る**（次ページの先読みはしない。端で止まる。結果に書く）
- 保存ボタンは `⋯` にしまわない（モックは `⋯` だが、中身が 1 つしかないメニューは作らない）

### ピンクの見え方（モックはホワイト）

**ホワイトの絵に合わせて作り、ピンクは既存の部品（`Card`・`surface`・`surface-tint`・`Text` の色）に任せる。**
画面ファイルで `appearance` を読まない（039 段階 2-a「分岐は部品の中に閉じる」。読んでよい 2 箇所は増やさない）。
色を直に書かない。両モードのスクリーンショットを証跡に残す（一覧・詳細・作成モーダル・ビューアの保存ボタン・ホーム）。

## 4. ダウンロード（1 枚）

### 段階0（B。最初に 30 分で確かめる。止まらない）

**R2 の署名付き GET URL に `response-content-disposition` を付けたとき、R2 がその `Content-Disposition` を返すか。**
S3 の仕様にはあり、R2 の S3 互換 API も対応を謳っているが、**A は実際に確かめていない**。
`wrangler dev --remote` か実際の Worker で 1 本試す（ローカルの `wrangler dev` の R2 は本物ではない）。

| 結果 | やり方 |
|---|---|
| **返る** | **(a)** `createDownloadUrl(config, key, filename)`: `response-content-disposition=attachment; filename="…"` をクエリに足してから署名（aws4fetch の `signQuery` はクエリ全部を正規化して署名に含める）。有効期限 **5 分**。Web は `<a href download>` を作ってクリック（新しいタブを開かない。`Linking.openURL` は空のタブが残る） |
| **返らない** | **(b)** 表示用の署名付き URL を `fetch` → `Blob` → `URL.createObjectURL` → `<a download>`。**`fetch` には R2 の CORS（GET・アプリのオリジン）が要る**。`r2-cors.json` にローカルは入っている。**本番オリジンが入っているかは人間に確かめてもらう**（016 の人間パート） |

**結果を `artifacts/041/download.md` に書いて、(a) か (b) を決めて進む。**A の手番は要らない（両方とも A が決めた形）。

- **`filename` はサーバが組み立てる**: `futary-YYYYMMDD-{imageId}.jpg`（`YYYYMMDD` は投稿日の JST。`imageId` は鍵の末尾）。ASCII のみ。
  クライアントから受け取らない（鍵と同じ理由。`security-requirements.md` 5節）
- **`photo.downloadUrl` は `readProcedure`**（ゲストもデモの写真を保存できる。デモの写真は見せているもの。隠す理由が無い）
- **`Content-Disposition` は `attachment` だけ**。`inline` の切り替えは持たない
- iOS Safari は `attachment` の画像を「ダウンロード」に入れる（写真アプリではない）。**それでよい**。写真アプリに直接入れるのは iOS アプリの話（`requirements.md` 5節「iOSアプリ配布」）

## 5. デモに入れる

`packages/db/seed/demo.ts` に**アルバム 1 件**（題名・期間つき。既存のデモ投稿の写真を 3 枚以上入れる）。
デモの投稿写真が 3 枚に満たなければ、あるだけ入れる（0 枚なら空のアルバム 1 件。結果に書く）。

## 6. やらないもの（先に決める）

| | 扱い |
|---|---|
| アルバム専用のアップロード | **しない**（0節 #1）。写真は投稿から |
| 投稿画面でアルバムを選ぶ | **しない**。作ってから足す。要るなら次 |
| アルバムのカラー | **持たない**（人間の指示） |
| 検索窓 | **置かない**（0節 #5） |
| ビューアのハート | **置かない**（0節 #6） |
| まとめてダウンロード（ZIP） | **042** |
| 写真の並べ替え（手動） | **しない**。投稿日時順 |
| 月ごとの自動アルバム（`requirements.md` 5節の旧記述） | **しない**。タイムライン + 手で作るアルバムで足りる |
| 共有リンク（モックの共有アイコン） | **しない**。R2 は非公開。公開 URL を作らない（`security-requirements.md` 5節） |

## 7. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | `couple_id` スコープ: 別ペアのアルバムは `list` に出ず、`get`/`update`/`addPhotos`/`removePhotos`/`delete` は `NOT_FOUND`（存在しない id と同じ応答） | `apps/api` |
| T2 | **別ペアの写真を `addPhotos` できない**（自ペアの `post_images` に無い ref は `INVALID_INPUT`）。`cover` も同じ | `apps/api` |
| T3 | `post.delete` で `album_photos` の該当行が消え、アルバムの `photoCount` が減る。**カバーだった写真が消えると `cover` が自動に倒れる** | `apps/api` |
| T4 | `photo.list`（タイムライン）が削除済み投稿の写真を出さない。**カーソルで全件を重複なく辿れる**（同秒の投稿 2 件を含める） | `apps/api` |
| T5 | 並び: タイムラインは新しい順、アルバムは古い順 | `apps/api` |
| T6 | `addPhotos` の冪等（同じ ref を 2 回送っても 1 行）・501 枚目で `LIMIT_REACHED` かつ 1 枚も入らない・101 件目のアルバムで `LIMIT_REACHED` | `apps/api` |
| T7 | `fillFromRange`: JST の日の境界（`2026-08-15` の 00:00 JST の直前の投稿は入らない・`endDate` の 23:59:59 JST は入る） | `apps/api` |
| T8 | `me.delete` が `album_photos`・`albums` を消す（既存の検査と同じ形） | `apps/api` |
| T9 | `photo.downloadUrl`: URL に `response-content-disposition` が含まれ（(a) のとき）、`filename` が `futary-YYYYMMDD-{imageId}.jpg` の形で、他ペアの ref は `NOT_FOUND` | `apps/api` |
| T10 | `album.list` / `album.get` / `photo.list` の queryKey に viewerKey（`viewer-key-coverage.test.ts` が拾うことを確かめる） | `apps/app` |
| T11 | 画面: ゲストは `+`・`⋯`・編集・選択が無い。タイムラインの詳細に `+`・編集・選択が無い。選択モードで 2 枚選ぶと「カバーにする」が押せない | `apps/app` |
| T12 | ビューア: `download` が無い画像に保存ボタンが出ない。**投稿カードからのビューアの見え方が（保存ボタン以外）変わっていない** | `apps/app` |
| T13 | ホーム: パネルが 9 枚で「アルバム」があり「今日どうだった？」が無い。他の 8 枚の並びが変わっていない | `apps/app` |
| T14 | マイグレーションの実体とファイルのずれ（既存の `schema-drift` 系のテストが `albums`・`album_photos` を拾う） | `packages/db` |

## 確認観点

- 写真付きの投稿をすると、タイムラインのアルバムの枚数が増える（自動）
- 期間を入れて作ると、その期間の写真が最初から入っている
- 写真を外してもタイムラインには残る。投稿を消すとアルバムからも消える
- ビューアの保存ボタンで、PC のブラウザと iPhone の Safari のどちらでも画像が保存される（**人間の実機**）
- ホームの 9 枚がピンク・ホワイトの両方で崩れない
- 詳細から戻れる（`(tabs)` の中にいる。タブバーが出ている）

## 完了条件

- 段階0の結果が `artifacts/041/download.md` にある
- T1〜T14 が緑。`pnpm -r test`・型チェック・lint
- `artifacts/041/` にスクリーンショット（両モード × ホーム・一覧・詳細・作成モーダル・写真を選ぶモーダル・ビューアの保存ボタン）
- 人間の実機で 1 枚保存できる
- `state.md` / `worklog.md`

## 停止条件

- `(tabs)` の動的ルートも `?id=` も `href: null` で隠せない → A に知らせる
- `album.list` の署名が 100 本を超える形にしかならない → A に知らせる（ページングを足すか、カバーを別手続きにするかは A が決める）
- `post.delete` の `batch()` に `album_photos` を足して FK に当たる → 止まる（`architecture.md` 4節を読んでから）
- 段階0で (a) も (b) も動かない（CORS が本番で開いていない等）→ 保存ボタン以外を先に仕上げ、保存は人間の手番（CORS の適用）として止まる

## 順序

040 のマージ後（済）。042 はこのタスクのマージ後。
