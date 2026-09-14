# 049（PR #345）— R の判定

futary-R で 21bb72d を checkout して実行した。app 527 緑・`tsc --noEmit` 緑・`eslint .` 緑。CI pass。差分は `apps/app` の `lib/album-upload.ts`・`album-detail.tsx`・テスト 2 本と証跡。契約 `album.addPhotos`（1〜20）・サーバ・DB に差分無し。`worklog.md` は追記のみ。触ったものは戻した。

**判定: 受け入れ。必須修正なし。**

## 壊して確かめたこと（`album-upload-batch.test.ts` + `album-detail-screen.test.tsx` 37 本）

| 壊し方 | 赤 |
|---|---|
| 失敗した塊で残りの塊も止める（`continue` → `break`） | 2 本 |
| 失敗した塊でも `addPhotos` を呼ぶ | 3 本 |
| 塊の途中の abort を見ない | 2 本 |
| 塊の PUT が済んでいても abort なら `addPhotos` を呼ばない | 1 本 |
| `stopOn`（PLAN_LIMIT）を無視して続ける | 2 本 |
| 塊を 20 ではなく 100 に | 9 本 |

## 読んで確かめたこと

- 0節 #2: 塊は `MAX_PHOTOS_PER_ADD`（契約の定数）から。契約は変えていない
- 0節 #3: 塊の中で 1 枚失敗 → その塊の残りは送らず `addPhotos` も呼ばない → 次の塊へ。`addPhotos` の失敗も同じ扱いで、`PLAN_LIMIT` だけ投げ直して 045 のシート（画面の `stopOn` は `ORPCError` の `code` を見る）
- 0節 #4: 進捗は PUT の済んだ枚数を通しで。失敗した塊の残りも進めて最後は `total`
- 0節 #5: 圧縮は 1 枚ずつ直列（T1 で `compressImage` の呼び出し順 = 選んだ順）
- 0節 #6: 選んだ時点で `albumQuotaRemaining` を超えていれば送る前に止まる（T5）。101 枚超の 1 行はその前（T3）。確認のシートは 20 枚超だけ
- 1節「送り終えた塊は残る」: abort は次の 1 枚に進む前に見て、塊の PUT が全部済んでいれば `addPhotos` を呼ぶ。閉じたら「N 枚まで入りました」。`finally` で `uploadProgress` を null にするので「やめる」も消える
- `uploadAlbumImages`（041）はカバーの 1 枚が使うので残っている。`compose` は触っていない
- `capture.json`: 確認「45 枚を送ります。少し時間がかかります」→ PUT 25・`addPhotos` 1（20 枚）→ 進捗「22 / 45」→ やめる →「0 枚まで入りました」（ローカルの `addPhotos` は実体が無いので 400。B の報告どおり。画面の経路だけを見た）。スクリーンショットは `pink-album-detail-upload-progress.png` を見た（進捗の下に「やめる」）

## 記録（判定に使わない）

1. 塊の途中で「やめる」と、その塊で PUT の済んだ分（最大 19 枚）は `addPhotos` を呼ばない実体として R2 に残る。`architecture.md` 6節「孤児」の既知の形（回収可能を担保する方針）で、041 の失敗経路と同じ。件数が増える経路が 1 つ足されただけ。A の判断は要らないと思うが知らせておく
2. 1 つも入らないうちに閉じると「0 枚まで入りました」と出る（capture で実測）。定義の文言どおりで、誤りではない。気になるなら 0 のときだけ別の 1 行にする。任意

## 私が確かめていないこと

- 人間の実機（iPhone で 100 枚を 1 回で入れる → 048 の ZIP で 100 枚が落ちる）。停止条件「圧縮が途中で落ちる → 50」は人間の結果で
