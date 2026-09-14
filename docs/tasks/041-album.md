# 041: アルバム

## 目的

**人間の指示。写真をアルバムごとにまとめて見られるようにする。**

- **「タイムライン」というアルバムが最初からあり、写真付きの投稿の写真が自動で集まる**
- **アルバムはイベントごとに作れる**（京都旅行・誕生日…）。**写真はアルバムに直接アップロードする**（モックの絵）
- **写真をダウンロードできる**（タイムラインの写真も。今は保存する手段が無い）
- 絵は `docs/sample/simpleMode/アルバム機能/モック画面/`（4 枚 + ホームアイコン 1 枚）。
  **モックはホワイトの絵。ピンクは既存の部品に任せる**（3節「ピンクの見え方」）。
  **モックの「アルバムのカラー」は使わない**（人間の指示。色の列を持たない）

**用語**: 人間は「グループ」と呼んだが、モックの画面名が「アルバム」で、ひとつひとつも「新しいアルバム」なので、
**機能名も 1 つ 1 つも「アルバム」**にする。表は `albums`。契約は `album.*`。コードに「group」を使わない。

## 0. 先に決めたこと（A。覆すなら人間が言う）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | アルバムの写真はどこから来るか | **アルバムに直接アップロードする**（`post.uploadUrl` と同じ署名付き PUT。R2 のキーは `couples/{coupleId}/albums/{imageId}.jpg`）。**タイムラインの写真を作ったアルバムに入れる経路は持たない**（9節。人間の決定） | モックがそう描いている。アルバムの写真が投稿の行に依存すると、投稿を消したときアルバムからも消える。**アルバムは残しておくもの**で、投稿とは寿命が違う |
| 2 | ホームの入口 | **「今日どうだった？」のパネルを「アルバム」に置き換える。9 枚 = 3 列 × 3 行のまま** | 10 枚目を足すと 3+3+3+1 で崩れる。「今日どうだった？」は押しても何も起きない次フェーズの枠（`requirements.md` 5節）。**動くものを出し、動かないものを引っ込める**（`architecture.md` 3節）。次フェーズで作るときに入口を考え直す |
| 3 | ダウンロード | **1 枚ずつ**はこのタスク（ビューアに保存ボタン。タイムラインとアルバムで同じビューアなので両方に効く。PC は `<a download>`、iPhone は共有シート = 段階2）。**選んだ写真をまとめて写真ライブラリへは 042** | 1 枚は署名付き URL に `Content-Disposition: attachment` を付けるだけ（4節）。複数は同じ共有シートに複数の `File` で、上限の実測が要る。このタスクに乗せると重い |
| 4 | タイムラインのアルバム | **行を持たない。**`post_images` から毎回引く（仮想） | 自動で集まるものを表に写すと、投稿の作成・削除のたびに同期する経路ができる |
| 5 | 検索窓（モックの上部） | **置かない** | 検索は `requirements.md` 5節でスコープ外。アルバムは 1 ペア 100 件までなので、並べれば見える |
| 6 | ビューアのハート（モック） | **置かない** | リアクションは投稿に付くもの。写真ごとに付け直す機能は作らない |
| 7 | 写真ごとの説明文 | **持つ**（`caption`。0〜200 文字。任意） | モックのビューアの「夕暮れの伏見稲荷大社。二人で歩き切った達成感。」はこれ。投稿本文ではない |

## 1. データモデル

```sql
CREATE TABLE albums (
  id             TEXT PRIMARY KEY,
  couple_id      TEXT NOT NULL REFERENCES couples(id),
  title          TEXT NOT NULL,                    -- 1〜50 文字（trim 後）
  note           TEXT NOT NULL DEFAULT '',         -- 0〜200 文字
  start_date     TEXT,                             -- YYYY-MM-DD。NULL 可
  end_date       TEXT,                             -- YYYY-MM-DD。NULL 可。start_date が無いと持てない。start_date 以上
  cover_photo_id TEXT,                             -- カバー。NULL なら自動（アルバム内でいちばん新しい写真）。FK は張らない（下記）
  created_by     TEXT NOT NULL REFERENCES user(id),-- 返さない（wishes と同じ。両方が触れるので canEdit も無い）
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER                           -- 論理削除
);
CREATE INDEX albums_couple_created_idx ON albums (couple_id, created_at DESC);

CREATE TABLE album_photos (
  id          TEXT PRIMARY KEY,                    -- imageId（ULID。サーバが生成）と同じ値
  album_id    TEXT NOT NULL REFERENCES albums(id),
  key         TEXT NOT NULL UNIQUE,                -- R2 のキー。サーバが組み立てる（couples/{coupleId}/albums/{id}.jpg）
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  caption     TEXT NOT NULL DEFAULT '',            -- 0〜200 文字
  taken_at    INTEGER NOT NULL,                    -- 並び順に使う。アップロードなら追加した時刻。アップロードした時刻
  created_at  INTEGER NOT NULL
);
CREATE INDEX album_photos_album_taken_idx ON album_photos (album_id, taken_at, id);
```

- **`album_photos` は論理削除を持たない。**外す = 行の物理削除 + R2 の物理削除（`post_images` と同じ。`architecture.md` 6節「削除の順序」: **D1 → R2**、R2 の失敗で操作を失敗させない）
- **`key` の UNIQUE** は `post_images.key` と同じ理由（実体と行を 1 対 1 に。`architecture.md` 6節）
- **カバーに FK を張らない。**カバーの写真が外れたときは、読むときに「アルバム内に無ければ自動」に倒す
  （読む側の 1 箇所で倒す方が D1 の `batch()` の順序を気にしなくてよい）
- **`me.delete` は `album_photos` → `albums` の順に行を消し、R2 は `albums/` の接頭辞で消す**（`architecture.md` 4節「表を足したら、消す手順にも足す」。040 の `wants/` と同じ形）
- **上限**: アルバムは 1 ペア **100 件**（未削除）。1 アルバムの写真は **500 枚**。超えたら `LIMIT_REACHED`
- **CHECK は持たない**（027・040 と同じ。`end_date >= start_date` は入力スキーマで弾く）
- **タイムライン（仮想）**: `posts.deleted_at IS NULL` の `post_images` 全部。行は持たない（0節 #4）
- 投稿の写真とアルバムの写真は**別の実体**。投稿を消してもアルバムは変わらず、アルバムから外しても投稿は変わらない

### 写真の並び順

| | 並び |
|---|---|
| タイムライン | **新しい順**（タイムラインの画面と同じ） |
| アルバム | **古い順**（`taken_at` の昇順。旅行の 1 日目が先に来る。アルバムは「出来事を順に見る」もの） |

同じアルバム内でも `taken_at` → `id` の順で決める（同秒でも揺れない）。

## 2. 契約（oRPC）

```
PhotoRef  = { kind: "post", postId: string, position: number (0..3) }   -- タイムラインの写真
          | { kind: "album", photoId: string }                          -- アルバムの写真
Photo     = { ref: PhotoRef, url, width, height, takenAt, caption }
            タイムラインの写真は takenAt = posts.created_at、caption = 投稿本文
Album     = { id, title, note, startDate, endDate, photoCount, cover: { url, width, height } | null, createdAt }
```

| 手続き | 種別 | 入力 | 出力 | 備考 |
|---|---|---|---|---|
| `album.list` | read | `{}` | `{ timeline: { photoCount, previews: Photo[] (最新 4 枚) }, items: Album[] }` | 未削除。**新しい順**（`created_at`）。ページング無し（100 件上限）。**T-viewerKey の対象** |
| `album.get` | read | `{ id }` | `Album` | 他ペア・削除済み・存在しない → `NOT_FOUND` |
| `photo.list` | read | `{ albumId?: string, cursor?, limit }` | `{ items: Photo[], nextCursor }` | **`albumId` 無し = タイムライン**（全投稿写真・新しい順）。あればそのアルバムの写真（古い順）。`post.list` と同じカーソル方式。`limit` 最大 60。**T-viewerKey の対象** |
| `album.uploadUrl` | write | `{ contentType: "image/jpeg" }` | `{ imageId, url }` | `post.uploadUrl` と同じ形（署名付き PUT・5 分・ULID）。**JPEG のみ**（クライアントが圧縮する。ADR-007） |
| `album.create` | write | `{ title, note?, startDate?, endDate?, cover?: { imageId, width, height } }` | `Album` | `cover` があれば **R2 に実体があることを確認してから** 最初の 1 枚として入れ、カバーにする（`post.create` と同じ検査。無ければ `INVALID_INPUT` で**アルバムも作らない**） |
| `album.update` | write | `{ id, title?, note?, startDate?, endDate?, coverPhotoId?: string \| null }` | `Album` | 渡されなかった項目は変えない。`coverPhotoId` は**アルバム内の写真**でなければ `INVALID_INPUT`。`null` で自動。**`startDate` を `null` にすると `endDate` も外れる。**`endDate` だけを明示的に渡して開始日が無い・開始日より前なら `INVALID_INPUT`（黙って捨てない） |
| `album.addPhotos` | write | `{ id, photos: [{ imageId, width, height, caption? }] (1〜20) }` | `Album` | **全部の実体が R2 にあることを確認してから**書く（1 枚でも無ければ `INVALID_INPUT`。部分的に入れない。`post.create` と同じ）。合計が 500 を超えるなら `LIMIT_REACHED`。`taken_at` = 今 |
| `album.updatePhoto` | write | `{ id, photoId, caption }` | `Photo` | 説明文だけ変える |
| `album.removePhotos` | write | `{ id, photoIds: string[] (1〜100) }` | `Album` | 行を物理削除（D1 → R2）。入っていない id は無視 |
| `album.delete` | write | `{ id }` | `{ id }` | 論理削除 + `album_photos` は物理削除（同じ `batch()`）→ R2 を消す |
| `photo.downloadUrl` | read | `PhotoRef` | `{ url, filename }` | **`Content-Disposition: attachment` 付きの署名付き GET URL（有効 5 分）**。4節。`kind` の両方を受ける |

- 他ペアの `id` は `NOT_FOUND`（存在を教えない。`want.*` と同じ）
- `photo.list`（タイムライン）は `posts.deleted_at IS NULL` を必ず含める（`architecture.md` 4節）
- 署名付き URL は `post.list` と同じ `createGetUrl`。**`album.list` は `previews` 4 枚 + カバー最大 100 枚を署名する。**
  `clientFor` の使い回し（031）があるので CPU は 1 リクエスト 100 署名まで許容する。**超える形（ページ 1 枚で 500 署名）は作らない**
- `album.uploadUrl` で発行して `addPhotos` に来なかった `imageId` は孤児になる（投稿と同じ。`architecture.md` 6節「アップロードされたが投稿に紐づかなかった画像」の回収対象に `albums/` を足す）

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
- **`⋯`**: 「編集」「削除」。削除は確認を挟む（「アルバムを削除しますか？ 中の写真も消えます」）。**ゲストは `⋯` を出さない**
- **`+`（ヘッダー右）**: 作成モーダル。**FAB にしない**（FAB は投稿のもの。040 と同じ）。ゲストは出さない
- 空: 「イベントごとに写真をまとめられます」（タイムラインのカードの下）

### 作成・編集モーダル

モックの「新しいアルバム」から**カラーだけを落とした**形。

| 項目 | 必須 | 備考 |
|---|---|---|
| **カバー写真を選択** | 任意 | **作成時だけ**。モックの大きな四角。押すと画像を選ぶ（`compose` と同じ選び方・圧縮）。選ぶとその場に見える。**作成時に署名付き PUT でアップロードし、`album.create` の `cover` に渡す**。編集ではカバーは詳細の選択モードで変える（下記） |
| アルバム名 | 必須 | 1〜50 文字。プレースホルダ「例：京都旅行」 |
| 開始日 / 終了日 | 任意 | `date-input8`（既存）。終了日は開始日が無いと入れられない。開始日 > 終了日なら保存できない（理由を 1 行） |
| メモ | 任意 | 0〜200 文字 |

- 「作成」で閉じて**詳細へ進む**（作ったら次は写真を入れるので）。「編集」の保存は閉じるだけ
- アップロード中は「作成」を無効にして「写真を送っています…」（040 の「取得中…」と同じ形）
- 二重発火は `Button` が防ぐ（`conventions.md` 4節）

### 詳細: `(tabs)/album-detail.tsx?id=`（`href: null`）

`id` が `timeline` ならタイムライン（仮想）。ULID は 26 文字の英数大文字なので衝突しない。
**動的ルート（`[id].tsx`）にしない。**`apps/app` は `web.output="static"` で「動的セグメントが無いので全ルートが実ファイルとして書き出せる」前提
（`scripts/build-public.mjs`）。**`(tabs)` の外に出さない**（`architecture.md` 3節「ボトムタブを消さない」）。
ヘッダー左に「‹ 戻る」（行き先は一覧に固定。`href: null` の画面同士では履歴に依存するとホームへ戻ることがある）。
ヘッダーの `+`・「編集」「選択」「やめる」は `navigation.setOptions` で置く。

```
 ‹ 戻る  京都旅行           編集  選択
┌────────────────────────┐
│        カバー（横長）        │   ← タイムラインは最新の 1 枚
└────────────────────────┘
   2026年8月15日 - 8月17日
   38枚の写真・3日間の思い出
┌──┐┌──┐┌──┐
│  ││  ││  │   ← 3 列の正方形グリッド。押すとビューア
└──┘└──┘└──┘
                         (+)   ← 写真を追加（FAB。アップロード）。タイムラインには無い
```

- **見出しの 2 行**: 期間（`startDate`〜`endDate`。片方だけなら 1 日。無ければ出さない）と「N枚の写真・M日間の思い出」
  （M = `diffDays + 1`。期間が無ければ「N枚の写真」だけ）。`packages/date` を使う。**日付計算を画面に書かない**（`architecture.md` 5節）
- **`+`（FAB）**: **写真を追加（アップロード）**。このタスクでは**ここだけ FAB を使う**（投稿の FAB はこの画面に無い）。
  押すと画像を選ぶ（**複数選択**。`compose` の選び方を複数にする。**1 回 100 枚まで**。049）→ クライアントで圧縮 → **1 枚ずつ直列に**署名付き PUT（進捗を出すため。`imageId` の ULID が選んだ順に並ぶ）→
  `album.addPhotos`（**20 枚ずつ**に割って順に。049）。進捗は「3 / 12 枚を送っています…」の 1 行。**途中で失敗したら 1 枚も入れない**（`addPhotos` が全部の実体を確かめてから書く）
  → 「送れませんでした。もう一度お試しください」。**タイムラインには無い**（自動）
- **選択**: 押すと選択モードに入る（ヘッダーが「N 枚を選択中」「やめる」になり、写真にチェックが出る）。
  下に「カバー」（**1 枚のときだけ**押せる）「削除」（確認: 「N 枚を削除しますか？」）。**タイムラインには無い**。
  **バーのラベルは 1 語**（「保存」「カバー」「削除」）。iPhone の幅で「カバーにする」「保存（7 枚）」は 2 行に折れた（人間の実機）。枚数はヘッダーの「N 枚を選択中」にある
  **長押しにしない**（Web での長押しは安定しない。040 の `⋯` と同じ判断で、ここは選択モードにする）
- **編集**: 作成・編集モーダル（上記）。タイムラインには無い
- **空のアルバム**: 「写真を追加しましょう」+ FAB。カバー領域は `surface-tint` の四角
- ゲスト: 見られる。`+`・選択・編集を出さない

### ビューア（既存の `image-viewer.tsx` を広げる）

**新しいビューアを作らない。**`ImageViewer` に 3 つ足す。

| 足すもの | 中身 |
|---|---|
| `caption?: { title: string; date: string; body: string }` | 画像ごと。下に重ねて出す（モックの左下）。`body` は **3 行で省略**。無ければ何も出さない（**タイムラインの投稿カードからの表示は今のまま**。変えない） |
| `download?: PhotoRef` | 画像ごと。あれば**右下に保存ボタン**。押すと `photo.downloadUrl` → 4節の方法で保存。無ければボタンを出さない |
| `onEditCaption?: (index) => void` | アルバムの写真だけ。説明文を押すと 1 行の入力（モーダル）→ `album.updatePhoto`。ゲスト・タイムラインでは渡さない |

- **投稿カード（タイムライン）からのビューアにも `download` を渡す**（人間の「タイムラインの写真もダウンロードしたい」）。`caption` は渡さない（本文はカードに見えている）
- アルバムからのビューアは `caption` = { アルバム名（タイムラインなら「タイムライン」）, `takenAt` の日付, `caption`（タイムラインなら投稿本文） }。
  説明文が空なら「説明を追加」を薄く出す（アルバムだけ。押すと入力）
- 「n / 総数」・閉じる 3 導線・スワイプ・左右ボタンは 033 のまま。**アルバムでは `photo.list` の読み込み済みの範囲を送る**（次ページの先読みはしない。端で止まる）。
  グリッドは 60 枚ずつ取り、**「もっと見る」のボタン**で次ページ（`ScrollView` のため端での自動読み込みはしない）
- **思い出カード（`memory-card.tsx`）からのビューアにも `download` を渡す**（投稿の写真であることは同じ）
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

- **`filename` はサーバが組み立てる**: `futary-YYYYMMDD-{imageId}.jpg`（`YYYYMMDD` は `takenAt` の JST。`imageId` は鍵の末尾）。ASCII のみ。
  クライアントから受け取らない（鍵と同じ理由。`security-requirements.md` 5節）
- **`photo.downloadUrl` は `readProcedure`**（ゲストもデモの写真を保存できる。デモの写真は見せているもの。隠す理由が無い）
- **`Content-Disposition` は `attachment` だけ**。`inline` の切り替えは持たない
- iOS Safari は `attachment` の画像を「ダウンロード」に入れる（写真アプリではない）。**それでよい**。写真アプリに直接入れるのは iOS アプリの話（`requirements.md` 5節「iOSアプリ配布」）

## 5. デモに入れる

`packages/db/seed/demo.ts` に**アルバム 1 件**（題名・期間つき。`docs/sample/風景/` 等の既存のデモ用の写真から 3 枚を `albums/` のキーで R2 に置く。
既存のデモ画像の置き方に倣う。**`post_images` のキーと同じオブジェクトを指さない**）。

## 6. やらないもの（先に決める）

| | 扱い |
|---|---|
| 投稿画面でアルバムを選ぶ | **しない**。要るなら次 |
| タイムラインの写真をアルバムに入れる | **しない**（9節。人間の決定。同じ写真をもう一度アップロードすれば済む） |
| アルバムのカラー | **持たない**（人間の指示） |
| 検索窓 | **置かない**（0節 #5） |
| ビューアのハート | **置かない**（0節 #6） |
| 選んだ写真をまとめて写真ライブラリへ | **042**（共有シートに複数の `File`）。**ZIP は作らない**（「ファイル」に落ちるだけで要望に合わない） |
| 写真の並べ替え（手動）・撮影日の編集 | **しない**。`taken_at` 順。EXIF はクライアントの圧縮で落ちるので撮影日は取れない |
| 月ごとの自動アルバム（`requirements.md` 5節の旧記述） | **しない**。タイムライン + 手で作るアルバムで足りる |
| 共有リンク（モックの共有アイコン） | **しない**。R2 は非公開。公開 URL を作らない（`security-requirements.md` 5節） |
| JPEG 以外のアップロード | **しない**（投稿と同じ。クライアントが JPEG に圧縮する） |

## 7. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | `couple_id` スコープ: 別ペアのアルバムは `list` に出ず、`get`/`update`/`addPhotos`/`updatePhoto`/`removePhotos`/`delete` は `NOT_FOUND`（存在しない id と同じ応答） | `apps/api` |
| T2 | `album.create`（`cover` あり）・`addPhotos`: **R2 に実体が無い `imageId` は `INVALID_INPUT` で、アルバムも行も作られない**（複数枚のうち 1 枚だけ無い場合を含む） | `apps/api` |
| T3 | `removePhotos`・`album.delete`・`me.delete` が D1 の行を消してから R2 を消す。**R2 の削除が失敗しても手続きは成功する**（既存の `post.delete` の検査と同じ形）。カバーだった写真を外すと `cover` が自動に倒れる | `apps/api` |
| T4 | `photo.list`（タイムライン）が削除済み投稿の写真を出さない。**カーソルで全件を重複なく辿れる**（同秒の投稿 2 件・同秒のアルバム写真 2 枚を含める） | `apps/api` |
| T5 | 並び: タイムラインは新しい順、アルバムは古い順 | `apps/api` |
| T6 | 501 枚目で `LIMIT_REACHED` かつ 1 枚も入らない・101 件目のアルバムで `LIMIT_REACHED` | `apps/api` |
| T7 | `coverPhotoId` に別のアルバムの写真・別ペアの写真を渡すと `INVALID_INPUT` / `NOT_FOUND` | `apps/api` |
| T8 | `me.delete` が `album_photos`・`albums` の行と `albums/` の R2 オブジェクトを消す（040 の `wants/` と同じ形） | `apps/api` |
| T9 | `photo.downloadUrl`: `kind` 両方で URL に `response-content-disposition` が含まれ（(a) のとき）、`filename` が `futary-YYYYMMDD-{imageId}.jpg` の形で、他ペアの ref は `NOT_FOUND` | `apps/api` |
| T10 | `album.list` / `album.get` / `photo.list` の queryKey に viewerKey（`viewer-key-coverage.test.ts` が拾うことを確かめる） | `apps/app` |
| T11 | 画面: ゲストは `+`・`⋯`・編集・選択が無い。タイムラインの詳細に `+`・編集・選択が無い。選択モードで 2 枚選ぶと「カバー」が押せない | `apps/app` |
| T12 | ビューア: `download` が無い画像に保存ボタンが出ない。**投稿カードからのビューアの見え方が（保存ボタン以外）変わっていない** | `apps/app` |
| T13 | ホーム: パネルが 9 枚で「アルバム」があり「今日どうだった？」が無い。他の 8 枚の並びが変わっていない | `apps/app` |
| T14 | マイグレーションの実体とファイルのずれ（既存の `schema-drift` 系のテストが `albums`・`album_photos` を拾う） | `packages/db` |
| T15 | アップロードの途中で 1 枚失敗したら `addPhotos` を呼ばない（画面結合。`fetch` をモック） | `apps/app` |

## 8. 段階2: iPhone では写真ライブラリに保存する（共有シート）

**人間の実機（2026-09-14）**: 段階1の保存は iPhone Safari で「ダウンロード」に落ちる（想定どおり動いた）が、
**写真ライブラリに入れるには「その他…」を経由する必要があり、遠い**。**直で写真ライブラリに入れたい**（人間の要望）。

Web に写真ライブラリへ直接書く口は無い。**いちばん近いのは Web Share API に `File` を渡す形**
（`navigator.share({ files })`）。iOS Safari の共有シートに「画像を保存」が出て、**1 タップで写真に入る**。

| 環境 | 保存の経路 |
|---|---|
| `navigator.canShare({ files })` が真（iPhone・Android の Safari/Chrome） | **共有シート**。署名付き URL を `fetch` → `Blob` → `File`（`filename`・`image/jpeg`）→ `navigator.share({ files: [file] })` |
| 偽（PC） | **今のまま**（`<a href download>`。段階1の (a)） |

- **`photo.downloadUrl` は変えない。**`filename` はそこから取る。`fetch` するのはその URL（`attachment` が付いていても `fetch` には関係ない）
- **利用者が共有シートを閉じた（`AbortError`）ときは何もしない**（失敗の 1 行を出さない）。それ以外の失敗は `<a download>` に倒す
- **前提: 本番 R2 の CORS に GET とアプリのオリジンがあること**（`fetch` は `<img>` と違って CORS が要る）。**人間に `r2:cors:list` で確かめてもらってから着手**
- **段階0（B。人間の iPhone で確かめる）**: `fetch` を `await` したあとの `navigator.share` が **`NotAllowedError` にならないか**
  （Safari はユーザー操作から離れた `share` を拒む。iOS 15 以降は一時的な活性化の窓があるが、A は実測していない）。
  **駄目なら、ビューアで写真を開いた時点で `Blob` を先に取っておき、押した瞬間に `share` だけを呼ぶ**（先読みは表示中の 1 枚だけ）
- テスト: `canShare` が真なら `share` が `File` 1 つで呼ばれ `<a>` は作られない・偽なら `<a download>`（段階1のまま）・`AbortError` で何も出ない・他の失敗で `<a download>` に倒れる

**選んだ写真をまとめて写真ライブラリに入れるのは 042**（同じ共有シートに複数の `File`）。

## 9. タイムラインの写真をアルバムに入れる（やらない）

**人間の決定（2026-09-14）: 要らない。**同じ写真をもう一度アップロードすれば済む。
投稿の写真は「タイムライン」のアルバムに自動で入り、作ったアルバムには「+」からアップロードしたものだけが入る。
`album.copyFromPosts`（R2 の実体の複製）は作らない。

## 確認観点

- 写真付きの投稿をすると、タイムラインのアルバムの枚数が増える（自動）
- 作成画面でカバーを選んで作ると、詳細にその 1 枚が入っていてカバーになっている
- FAB から 5 枚まとめて入れられる。進捗が見える
- アルバムから写真を消してもタイムラインは変わらない。投稿を消してもアルバムは変わらない
- ビューアの保存ボタンで、PC のブラウザと iPhone の Safari のどちらでも画像が保存される（**人間の実機**）
- ホームの 9 枚がピンク・ホワイトの両方で崩れない
- 詳細から戻れる（`(tabs)` の中にいる。タブバーが出ている）

## 完了条件

- 段階0の結果が `artifacts/041/download.md` にある
- T1〜T15 が緑。`pnpm -r test`・型チェック・lint
- `artifacts/041/` にスクリーンショット（両モード × ホーム・一覧・詳細・作成モーダル（カバー選択後）・アップロードの進捗・ビューアの保存ボタン）
- 人間の実機で 1 枚保存できる・5 枚アップロードできる
- `state.md` / `worklog.md`

## 停止条件

- `(tabs)` の動的ルートも `?id=` も `href: null` で隠せない → A に知らせる
- `album.list` の署名が 100 本を超える形にしかならない → A に知らせる
- `compose` の画像選択を複数にする変更が `compose` 自体の挙動を変えてしまう → 別の部品に分けて、結果に書く。**投稿の 4 枚の見え方を変えない**
- 段階0で (a) も (b) も動かない（CORS が本番で開いていない等）→ 保存ボタン以外を先に仕上げ、保存は人間の手番（CORS の適用）として止まる

## 順序

040 のマージ後（済）。段階2（共有シート）は段階1のデプロイ後（済）に人間の要望で決めた。042 は段階2の後。

## 進捗

- 2026-09-14 段階0・段階1: B が実装（PR #294。報告は `artifacts/041/stage1.md`。段階0は (a)）。B が決めた 10 点は A が全部受け入れ、定義を今の形に合わせた（#295）
- 2026-09-14 R の判定（`artifacts/041/review-stage1.md`）: 必須修正 1 件（`removePhotos` の `IN` が D1 のパラメータ上限 100 を超える。50 個ずつ `batch()` に）。
  A の決定: 直す（設計は変わらない。上限は `architecture.md` 4節に条文として残した）。**R の記録（タイムラインの `posts.deleted_at IS NULL` をテストが見ていない）も同じ PR で 1 本足す**（`posts.deleted_at` を SQL で直接立てて写真行を残す）。今は到達不能でも、条文は試せる形で置く
- 2026-09-14 段階2（共有シート）: B が実装（#300。main 82dd476）。R 受け入れ（`artifacts/041/review-stage2.md`）。デプロイ後の人間の iPhone で共有シートが出て写真ライブラリに入った（`await fetch` 後の `share` は拒まれない）。**段階2 完了。**042 へ
- 2026-09-14 段階1 マージ（#294。main 4f4b529）・`0022_albums.sql` リモート適用・デプロイ完走。人間の実機（iPhone Safari）: 概ね問題なし。保存は「ダウンロード」に落ちる（想定どおり）が
  写真ライブラリに直接入れたい・選んだ写真をまとめて入れたい、の 2 点の要望 → 前者を段階2（8節）、後者を 042 に定義した。ZIP は落とした
