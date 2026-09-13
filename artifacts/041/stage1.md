# 041 段階1: アルバム — 実装の報告

2026-09-13〜14 / セッションB。タスク定義（`docs/tasks/041-album.md`）の 0節「先に決めたこと」と段階0の結果（`download.md`。(a)）に従って実装した。

## 作ったもの

- `packages/db`: `albums`・`album_photos` 表（`0022_albums.sql`。`albums_couple_created_idx`・`album_photos_album_taken_idx`・`album_photos_key_unique`）。
  デモシードにアルバム 1 件（「ふたりの小さな旅」。題名・期間・メモ・カバー）と写真 3 枚（既存のデモ写真を `albums/` のキーで別のオブジェクトとして置く）
- `packages/contract`: `album.*` 9 手続き・`photo.*` 2 手続き（`src/album.ts`）。`PhotoRef` は `kind` の判別共用体
- `packages/date`: `formatDateJa`・`formatDateRangeJa`・`formatYearMonthSlash`・`formatJstDateSlash`・`formatJstDateCompact`・`inclusiveDays`（画面に日付計算を書かないため）
- `apps/api`: `procedures/album.ts`（`album.*` / `photo.*`）、`lib/r2-signed-url.ts` に `albumImageKeyFor`・`albumImagePrefixFor`・`imageIdOfKey`・`createDownloadUrl`、
  `me.delete` に `album_photos` → `albums` の行削除と `albums/` の接頭辞削除
- `apps/app`: `(tabs)/album.tsx`（一覧）・`(tabs)/album-detail.tsx`（詳細。`?id=`）・`components/album-form.tsx`・`components/sheet.tsx`（want.tsx から出した）・
  `lib/album-upload.ts`・`lib/photo-download.ts`、`ImageViewer` に説明文・保存ボタン・説明の編集、`PostImages` に `postId`（投稿カードのビューアにも保存ボタン）、
  ホームの「今日どうだった？」を「アルバム」に
- `packages/ui`: `panel-album.png`（ピンクの線画。B が描いた）・`panel-white-album.jpg`（ホワイトの写真タイル。人間の絵を 600×600 に）。出自は `docs/sample/README.md`

## T1〜T15

| # | 結果 | 場所 |
|---|---|---|
| T1 | 緑 | `apps/api/test/album.test.ts`「T1: couple_id スコープ」（別ペアの id と存在しない id を同じループで回し、応答が同じ NOT_FOUND であることを見る） |
| T2 | 緑 | 同「T2」（cover の実体無し → アルバムも作られない。3 枚中 1 枚無し → 0 枚。型違いは実体を消す。同じ imageId の二重は UNIQUE で INVALID_INPUT） |
| T3 | 緑 | 同「T3」（`removePhotos`・`album.delete` の D1 → R2。`delete` が reject する bucket でも成功して行は消える。カバーを外すと自動に倒れる） |
| T4 | 緑 | 同「T4 / T5」（同秒の投稿 2 件 × 2 枚・同秒のアルバム写真 3 枚を limit 2 で辿って重複なし。削除済み投稿は出ない） |
| T5 | 緑 | 同（タイムラインは新しい順・position 昇順。アルバムは古い順・同秒は id 昇順） |
| T6 | 緑 | 同「T6」（499 枚 + 2 枚 → LIMIT_REACHED で 499 のまま。500 枚目は入る。100 件目のアルバムがある状態で作成 → LIMIT_REACHED。削除すると作れる） |
| T7 | 緑 | 同「T7」（別のアルバム・別ペア・存在しない id の coverPhotoId はすべて INVALID_INPUT。**別ペアの写真も INVALID_INPUT**: 「このアルバムに無い」として区別しない） |
| T8 | 緑 | `apps/api/test/me.test.ts`（既存の 2 本の me.delete テストにアルバム + カバー写真を足した。機械的走査は albums を自動で拾い、`album_photos` は post_images と同じく手で確認） |
| T9 | 緑 | `album.test.ts`「T9」（kind 両方で `response-content-disposition=attachment; filename="futary-YYYYMMDD-{imageId}.jpg"`・`X-Amz-Expires=300`。他ペア・削除済み投稿・無い position は NOT_FOUND。ゲストも取れる）、`r2-signed-url.test.ts`（`createDownloadUrl`） |
| T10 | 緑 | `viewer-key-coverage.test.ts` が `album.tsx`（1）・`album-detail.tsx`（3）の `useQuery` / `useInfiniteQuery` を自動で拾う。**拾っていることを確かめた**: `album.tsx` の viewerKey を外すと `album.tsx:166:17 の useQuery(...): viewerKeyが確認できません`（`exact-missing`）で赤、戻すと緑 |
| T11 | 緑 | `album-screen.test.tsx`（ゲストは `⋯` もヘッダーの `+` も無い）・`album-detail-screen.test.tsx`（ゲスト・タイムラインに `+`・編集・選択が無い。2 枚選ぶと「カバーにする」が `aria-disabled`、1 枚に戻すと押せて `album.update` が呼ばれる） |
| T12 | 緑 | `post-card.test.tsx`「ImageViewer の保存ボタン（041）」（`download` 無しは保存ボタンも説明文も無い。投稿カードからは保存ボタンだけで説明文は無く、閉じる・カウンターは 033 のまま。押すと ref で `photo.downloadUrl` → `<a download>` をクリック。失敗の 1 行） |
| T13 | 緑 | `home-screen.test.tsx`（`aria-label` の並びが タイムライン・カレンダー・思い出・統計・**アルバム**・リスト・ほしいもの・気分の記録・AIまとめ の 9 枚。「今日どうだった？」「COMING SOON」が無い） |
| T14 | 緑 | `schema-integrity.test.ts` の index 一覧に 3 本を足した（足す前は赤: 実体に 3 本あって一覧に無い） |
| T15 | 緑 | `album-detail-screen.test.tsx`「アップロード（T15）」（2 枚目の PUT が reject → `addPhotos` を呼ばず「送れませんでした」。全部通れば `addPhotos` を 1 回だけ、選んだ順の imageId で） |

`pnpm -r test`: api 589 / app 386 / db 31 / ui 16 / date 66、すべて緑。`pnpm run type-check`・`pnpm run lint` 緑。

## B が決めたこと（A に見てほしい）

1. **詳細は `(tabs)/album-detail.tsx` + `?id=`**（`[id].tsx` にしなかった）。理由は `href: null` ではなく **静的エクスポート**: `apps/app` は `web.output="static"` で
   「動的セグメントが無いので全ルートが実ファイルとして書き出せる」前提（`scripts/build-public.mjs` のコメント）。動的ルートを足すとその前提が崩れる。
   A が許した倒し方の範囲内。`(tabs)` の中なのでタブバーは出たまま（スクリーンショット）
2. **詳細のヘッダー左に「‹ 戻る」を置いた**（行き先は一覧に固定。`router.push("/album")`）。既存の `href: null` の画面（リスト・ほしいもの）には戻るが無いが、
   詳細 → 一覧は本物の階層で、モックにも `‹` がある。`router.back()` にしなかったのは、Tabs の中の `href: null` の画面同士では履歴に依存して
   ホームへ戻ることがあったため（撮影スクリプトで実測）
3. **一覧の `+`・詳細の「編集」「選択」「やめる」はヘッダーに `navigation.setOptions` で置く**（モックどおり）。画面テストは `setOptions` に渡された
   `headerRight` を描画して確かめる
4. **`Sheet` を `components/sheet.tsx` に出し、`want.tsx` もそれを使うようにした**（同じ見た目のものを 2 つ持たない。want.tsx の見え方・テストは変えていない）
5. **タイムラインの詳細のカバーは最新の 1 枚**（タスク定義に無い。空なら surface-tint の四角）。タイムラインの枚数は `album.list` の `timeline.photoCount` から取る（行が無いので `album.get` は無い）
6. **`album.update` で `startDate` を `null` にすると `endDate` も外れる。**`endDate` だけを明示的に渡して開始日が無い・開始日より前なら INVALID_INPUT
   （終了日は開始日が無いと持てない、を「黙って捨てる」ではなく「明示的に渡したなら拒む」にした）
7. **思い出カード（`memory-card.tsx`）からのビューアにも保存ボタンを渡した**（投稿カードと同じ `PostImages` で、投稿の写真であることに変わりがないため）
8. **アップロードは 1 枚ずつ直列**（投稿の 4 枚は並行）。進捗「3 / 12 枚」を出すためと、`album.uploadUrl` の ULID が選んだ順に並ぶため（同秒の `taken_at` でも選択順で並ぶ）
9. 保存ボタンは `Button` 部品ではなくビューアの他のボタンと同じ入れ子の `Pressable`（見た目を揃える）。押している間は無効にして二重発火を防ぐ
10. `photo.list` の既定 limit は 30、画面は 60（最大）で取り、「もっと見る」のボタンで次ページ（スクロール端の自動読み込みにはしていない。`ScrollView` のため）

## 動作証跡（`artifacts/041/stage1/`）

ローカル（`wrangler dev` + expo web）。ログイン状態は `scripts/make-session.mjs` がローカル D1/R2 に作ったペア（ゆう・さき）・写真付き投稿 3 件（7 枚）・
アルバム 2 件（京都旅行: 3 枚 + 説明文 1 つ、誕生日: 0 枚）とセッション Cookie で再現した（Cookie の値は artifacts に置いていない）。撮影は `scripts/capture.mjs`。

| ファイル | 何を |
|---|---|
| `{pink,white}-home.png` / `-home-pc.png` | ホームの 9 枚。「今日どうだった？」の位置（2 行目の真ん中）に「アルバム」。他の 8 枚は動いていない |
| `{pink,white}-album-list.png` / `-list-pc.png` | 一覧: タイムラインのカード（「自動」・7 枚・右に 3 枚の列）、アルバム 2 件（題名・枚数・年月・`⋯`）、ヘッダー右の `+` |
| `{pink,white}-album-create.png` | 作成モーダル（カバー選択後。題名・開始日・終了日・メモ） |
| `{pink,white}-album-detail.png` | 詳細: カバー・「2026年8月4日 - 8月6日」「3枚の写真・3日間の思い出」・メモ・3 列・FAB・ヘッダーの「編集」「選択」「‹ 戻る」 |
| `{pink,white}-album-viewer.png` | ビューア: 左下に説明文（アルバム名・日付・本文）、右下に「保存」、上に「1 / 3」 |
| `{pink,white}-album-select.png` | 選択モード: 「2 枚を選択中」「やめる」・チェック・「カバーにする」が無効・「削除」 |
| `{pink,white}-album-upload-progress.png` | FAB → 3 枚選択 → 「0 / 3 枚を送っています…」（PUT を 1.5 秒遅らせて撮った） |
| `{pink,white}-album-timeline.png` | タイムラインの詳細（`+`・編集・選択が無い） |
| `{pink,white}-album-guest.png` / `-guest-detail.png` | ゲスト（デモペア）: `+`・`⋯`・編集・選択が無い。デモのアルバム「ふたりの小さな旅」 |
| `capture.json` | 保存ボタンを押したあとの遷移先 URL（`response-content-disposition=attachment; filename="futary-20260805-SHOTALBUMPHOTO00000000001.jpg"`・`X-Amz-Expires=300` がクエリにある）とコンソールエラー |

**画像の枠が空に見える理由**: ローカルの署名付き URL は本物の R2 を指し、ローカル R2 に置いた実体は届かない（`capture.json` の 404 はそれ。040 と同じ既存の制約）。
`capture.json` の 400 はアップロードの撮影で PUT を `page.route` で受け止めた（本物の R2 に置かない）ため、`addPhotos` がローカル R2 に実体を見つけられず INVALID_INPUT を返したもの（画面には「送れませんでした」が出る。想定どおり）。
本番では署名付き URL が実体を指す。**人間の実機確認（完了条件）で画像が見えること・保存できること・5 枚まとめて入ることを確かめてほしい。**

`photo.downloadUrl` の実際の応答（ローカル API に curl。署名は省く）:

```
filename: futary-20260805-SHOTALBUMPHOTO00000000001.jpg
path: /futary-images/couples/shot-couple/albums/SHOTALBUMPHOTO00000000001.jpg
query: X-Amz-Expires=300, response-content-disposition=attachment; filename="futary-20260805-SHOTALBUMPHOTO00000000001.jpg"
（投稿の写真）filename: futary-20260904-shot-post-image-3.jpg, 同じ形
```

## 確認観点との対応

| 観点 | |
|---|---|
| 写真付きの投稿をすると、タイムラインのアルバムの枚数が増える | `album.list` が `post_images` を毎回数える（行を持たない）。`album.test.ts`「album.list はタイムラインの枚数と最新 4 枚を返す」。画面は `pink-album-list.png`（7 枚） |
| 作成画面でカバーを選んで作ると、詳細にその 1 枚が入っていてカバーになっている | `album.test.ts`「cover を付けて作ると最初の 1 枚として入り、カバーになる」。画面からの一連は実機で（Playwright はファイル選択まで。`*-album-create.png`） |
| FAB から 5 枚まとめて入れられる。進捗が見える | `*-album-upload-progress.png`・T15。**5 枚は実機で** |
| アルバムから写真を消してもタイムラインは変わらない。投稿を消してもアルバムは変わらない | 別の表・別の実体（T3 は album_photos だけを消す。post.delete は post_images だけを消す）。`album.test.ts` T1 の「A 側は何も変わっていない」 |
| ビューアの保存ボタンで、PC のブラウザと iPhone の Safari のどちらでも画像が保存される | **人間の実機。**ローカルは 404 に遷移する（`download.md`） |
| ホームの 9 枚がピンク・ホワイトの両方で崩れない | `*-home.png` / `*-home-pc.png` |
| 詳細から戻れる（`(tabs)` の中にいる。タブバーが出ている） | `*-album-detail.png`（タブバーあり・「‹ 戻る」） |

## やっていないこと・残るもの

- 人間の実機: 1 枚保存できる・5 枚アップロードできる・画像が見える（完了条件）。ローカルでは R2 の制約で確かめられない
- 段階2（タイムラインの写真をアルバムに入れる）は段階1の受け入れ後（タスク定義8節）
- 設計文書（`architecture.md` 等）は変えていない。実装は 4・5・6節の記述と一致している（B が読み合わせた。`architecture.md` は詳細のルート名を書いていない）。
  タスク定義3節の `(tabs)/album/[id].tsx` だけが `album-detail.tsx?id=` と違う（上の「B が決めたこと」1）

## レビュー往復 1 回目（R の必須修正 1 件 + A の決定 #296）

- **必須修正: `album.removePhotos` の 1 文の束縛パラメータが D1 の上限（100）を超える**（`photoIds` 100 + 2 個）。R の直し方 (2) + 画面側の分割にした
  - サーバ: `photoIds` を 50 個ずつ（`REMOVE_PHOTOS_CHUNK_SIZE`）の DELETE に分けて 1 本の `db.batch()` に入れる（1 文 52 個。上限は batch 内の各文に個別）。契約はそのまま（1〜100）
  - 画面: 選択が 100 枚を超えたら `MAX_PHOTOS_PER_REMOVE` ずつに分けて順に送る（`lib/chunk.ts`）。途中で失敗したら残りは送らない
  - テスト: `album.test.ts`「100 枚を 1 回の removePhotos で消せる。文ごとの束縛パラメータは D1 の上限（100）を超えない」（`db.prepare` を Proxy で包み、SQL の `?N` の数と bind の個数の大きい方を文ごとに記録して ≤ 100 を固定。2 文以上に分かれていることも見る）、
    `album-detail-screen.test.tsx`「101 枚選んで削除すると 100 枚 + 1 枚の 2 回に分かれて呼ばれる」、`chunk.test.ts`
- **R の記録 1（A の決定で同じ PR に）: `posts.deleted_at IS NULL` の条件そのものを見るテスト**を 1 本足した（`album.test.ts`「posts.deleted_at IS NULL の条件そのもの」。
  `deleted_at` を SQL で直接立てて `post_images` を残し、`photo.list`・`album.list` の timeline・`photo.downloadUrl` に出ないことを見る）。
  **条件を外すと赤になることを確かめてから戻した**（`TIMELINE_SELECT` の `AND posts.deleted_at IS NULL` を外す → 1 件赤、戻す → 緑）
- R の記録 2（100 枚を超える選択が BAD_REQUEST）は上の画面側の分割で消えた
