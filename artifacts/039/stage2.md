# 039 段階2: モック固有の形（ホワイトのときだけ）

人間の OK（A 経由「問題ない」）を受けて着手。**段階2の差分は全部 `appearance === "white"` の側にある。**
ピンクはホーム・タイムライン・統計で main と画素 0 差（7節）。

## 1. a〜h の結果

| # | 画面 | やったこと | どこで |
|---|---|---|---|
| a | ホーム | ロゴ画像 → **文字の「futary」**（Poppins 300。下記 2節） | `index.tsx`（画面ファイルで `appearance` を読む2箇所のうち1つ） |
| b | ホーム | 記念日カード: **リング無し・ハート無し・「付き合って」の小見出し無し・数字は黒の Poppins 800・右下に「日目」・「会った日数：94日」は素の muted 文字**。地は `surface` + `border` 1px（半透明・上端の縁・スパークルも無し） | `stats-card.tsx` |
| c | ホーム | 機能パネル: **白いカード + `border` 1px の中に、正方形の写真タイル（`radius.input`）+ 日本語ラベル + 使えないものは「近日公開」（muted）。**「COMING SOON」は出さない。押せる/押せないを濃さで見せない（モックは写真をそのまま見せる） | `feature-panel.tsx` |
| d | 全画面 | ボトムタブの `border` 1px は段階1で前倒し済み。FAB は黒（段階1の `FabIcon`）。光彩は値 0 | — |
| e | タイムライン | **変更無し。**写真の角丸は元から `radius.input`(14)、名前は `bold`、日付は `muted`（`post-card.tsx` / `post-images.tsx` を読んで確認）。カードの枠線は段階1の `Card` | — |
| f | 統計 | **上にヒーロー写真（角丸・幅いっぱい・4:3）**、その下に小さく muted で「統計」、大きく bold で「統計」。**行は `border` の区切り線**（最後の行には引かない） | `stats.tsx`（画面ファイルで `appearance` を読む2箇所のうちの2つ目） |
| g | 全画面 | **足していない**（統計だけ。人間から答えが無く、タスク定義どおり。A の判断） | — |
| h | 全画面 | 「近日公開」は `feature-panel.tsx` の中だけ。「COMING SOON」も同じファイルのピンク側だけ（`git grep` で他に無いことを確認） | — |

**画面ファイルで `appearance` を読む箇所（列挙）**: `apps/app/app/(tabs)/index.tsx`（a）・`apps/app/app/(tabs)/stats.tsx`（f）。
段階1からの `(tabs)/_layout.tsx`（タブバーの枠線）と `(tabs)/profile.tsx`（切り替え UI の選択判定）はそのまま。
部品の中の分岐: `stats-card.tsx`・`feature-panel.tsx`（タスク定義が許した2部品）+ `packages/ui`（`Card` `Screen` `FabIcon`）。**3箇所目の画面ファイルは無い。**

## 2. B が決めた値と理由（a: ロゴ文字）

| 項目 | 値 | 理由 |
|---|---|---|
| フォント | Poppins **300**（latin サブセット。`apps/app/public/fonts/poppins-300.woff2`、約 8KB。Google Fonts `v24` の `pxiByp8kv8JHgFVrLDz8Z1xlFQ.woff2` を 035 と同じ置き方で self-host） | モックのロゴは細いジオメトリック欧文。500 だと太い |
| 大きさ | **40pt**、行の高さ 48 | モックのロゴは画面幅の約 27%（853px 中 230px）。390pt の画面なら幅 105pt。Poppins 300 の "futary" 6文字が幅 105 になるのは 40pt 前後。スクリーンショットで確認した |
| 字間 | **0.5** | モックはわずかに開いている。1.0 だと間延びした |
| 色 | `text`（`#1D1D1F`） | 見出しと同じ黒 |

**ピンクのロゴ画像はそのまま**（`home-logo-image`）。

## 3. B が決めた値と理由（c: 写真タイル）

| 項目 | 値 | 理由 |
|---|---|---|
| カード | `surface` + `border` 1px + `radius.input`(14)、内側の余白 6 | モックはカードの中にタイル。段階1の `Card` と同じ語彙 |
| タイル | 正方形（幅いっぱい。`aspectRatio: 1` の `View` に写真を敷く）、`radius.input`(14)、地は `surface-tint` | 幅の実測を待たずに正方形にできる。写真が無いときは地の上に線画アイコン（差し替え前でも壊れない） |
| ラベル | 11pt / 600、**2行ぶん（16×2）を常に確保** | 「今日どうだった？」だけ2行。使える/使えないでカードの高さが変わると4列の底が揃わない |
| 近日公開 | 10pt muted、**1行ぶん（14）を常に確保**（使えるものは空） | 同上。モックも行の高さは揃っている |
| 写真 | 600×600 JPEG（品質 82。8枚で 239KB） | PNG だと 8枚で 3.8MB あった。写真に PNG は要らない。表示は最大 160 CSS px × 2倍 = 320px なので 600 で足りる |

写真の差し替え口は `packages/ui/src/assets.ts` の1箇所（`panelPhoto*`）。**役割の名前で保存した**（元のファイル名を持ち込まない）。
対応は A の表（タスク定義「アセット到着」）を B が目視で確認した: 一致。

## 4. f: ヒーロー写真は仮

**人間からヒーロー画像はまだ無い。**`docs/sample/風景/RcmUGlPg.jpg`（夕暮れの海辺に立つ男女。後ろ姿・顔なし。AI 生成。
出自は `docs/sample/README.md`）を中央で 4:3（1280×960）に切り出し、`packages/ui/assets/stats-hero-placeholder.jpg` に置いた。
**本物が来たら `packages/ui/src/assets.ts` の `statsHeroPlaceholder` だけを差し替える。**
モックのヒーローに一番近い1枚（海辺・後ろ姿）を選んだ。

**要る形**: 横長 4:3、長辺 1280px（`layout.maxWidth` 640 × 2倍）。

`react-native-web` の `Image` に直接 `aspectRatio` を当てると効かず、縦長に伸びた（B が実機で確認。`View` で 4:3 の箱を作り、
中に `Image` を敷く形にした。機能パネルのタイルと同じ）。

## 5. テスト（`apps/app/test/white-stage2.test.tsx`）

| # | 何を |
|---|---|
| a | white では `home-logo-text`（Poppins 300 の「futary」）を描き画像を描かない。pink では画像のまま |
| b | white ではリング・ハート・「付き合って」・ピルが無く「会った日数：94日」が素の文字。**未来の日付（`dating_upcoming`）では「記念日まで あと」を残す**（数字の意味そのもの）。pink では従来どおり |
| c | white では写真タイル + 「近日公開」、「COMING SOON」無し。使えるものには「近日公開」無し。写真が無ければ線画アイコン。pink では「COMING SOON」で写真タイル無し |
| f | white ではヒーロー + 二段見出し + 区切り線の行。pink では無し |

段階1のテストはそのまま緑（`home-screen.test.tsx` の「COMING SOON」は pink 側の検査）。

`pnpm -r test`（apps/app 350件・packages/ui 16件）・`pnpm -r type-check`・`pnpm -w lint`、全て緑。

## 6. 入れた依存

**無し。**フォント1ウェイト（Poppins 300。静的ファイル）だけ。`apps/app/types/assets.d.ts` と `packages/ui/src/jpg.d.ts` に
`*.jpg` の型宣言を足した（PNG と同じ形。写真を JPEG にしたため）。

## 7. ピンクが変わっていないこと

`artifacts/039/stage2/pink-pixel-diff.json`（段階1と同じ手順。基準は `artifacts/039/baseline-main/`）:

| 画面 | 差のある画素 |
|---|---|
| ホーム | **0** |
| タイムライン | **0** |
| 統計 | **0** |
| マイページ（ゲスト） | 段階1と同じ（「見た目」カードのぶんの位置ずれだけ。バナー・タブバーは 0 差） |

## 8. ホワイトで全画面にピンクが残っていないこと

`artifacts/039/stage2/scan.json`。ゲストで開ける 10 画面すべて 0（段階1と同じ走査）。

## 9. スクリーンショット

`artifacts/039/stage2/`: `white-home.png`（a・b・c）・`white-stats.png`（f）・`white-timeline.png`（e。変更無しの確認）・
`white-profile.png`・`pink-*.png`（画素比較の元）。

## 10. やらなかったこと

- **「・/」の記号**（タスク定義6節）: やらない。余白だけ
- **二段見出しの他画面への展開**（g）: やらない
- **ヒーローの本物**: 人間待ち（4節）
- **ピンクの並び順**: 変えていない（モックと同じ並びだった）
- **`新機能/…Wishlist…`**: 使わない（人間の言）
- **ネイティブ**: 段階1と同じくメモリ保持のみ

## 11. 人間に見てほしいこと

1. ホームのホワイト（`stage2/white-home.png`）がモックの方向か。ロゴの大きさ（40pt）・タイルの写真
2. 統計のホワイト（`stage2/white-stats.png`）。ヒーローは**仮の写真**
3. ヒーロー用の本物の写真（横長 4:3、長辺 1280px）を `docs/sample/simpleMode/` に
4. iPhone 実機での見え方（Safari は B が測っていない）
