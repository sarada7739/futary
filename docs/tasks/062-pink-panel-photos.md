# 062: ピンクの機能パネルにも写真タイルを置く（ホワイトと同じ形に）

## 目的

**人間の指示（2026-09-18）。** ホームの機能パネル（3×3）は、ホワイトでは正方形の写真タイル + ラベル（039 段階2-c）だが、ピンクは線画アイコン + ラベルのまま。**ピンクもホワイトと同じく写真タイルにする。**

写真は `packages/ui/src/assets.ts` の `panelPhoto*`（9 枚。039 で人間が上げたもの）をそのまま使う。新しい絵は要らない。

## 0. 決めたこと（A）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | パネルの構造 | **外観で分けない。1 つの形にする**: 正方形の写真タイル（幅いっぱい・`aspectRatio: 1`・`radius.input`・地は `colors.surfaceTint`）+ 日本語ラベル（2 行ぶんの高さを常に確保）+ 注記の行（使えないものは「近日公開」。使えるものは空。高さは常に確保）。今の `WhitePanel` の構造をそのまま両方に | 外観の違いは色と影の語彙（039 の 4 節）であって、部品の形ではない。分岐を消せる |
| 2 | ピンクとホワイトの違い | **`useTheme()` の色と影だけ。**カードは `colors.surface` + `borderWidth: 1` + `colors.border` + `shadow.card`（ピンクは影あり・`border` は地とほぼ同色で見えない。ホワイトは `shadow.card` が無しなので枠線だけ。039 の 4 節「両方とも `border` 1px を持たせてよい」）。タイルの地は `colors.surfaceTint`（ピンク `#FCEEEC`・ホワイト `#F5F5F7`）。部品の中で `appearance` を読まない | トークンが外観を吸収する（039 の 5-2「分岐は部品の中に閉じる」より 1 段良い: 分岐が無い） |
| 3 | 「COMING SOON」 | **消す。**ピンクも「近日公開」（`textMuted`）。`opacity: 0.7` で押せないことを見せる仕組みも消す（ホワイトと同じく、文字だけで伝える） | 今は 9 枚とも押せる（041 で「今日どうだった？」を「アルバム」に替えた）ので、使えないパネルは無い。2 つの語を残す理由が無い。`home-screen.test.tsx` の「COMING SOON が出ない」はそのまま緑 |
| 4 | 写真が無いとき（`photo` 省略） | タイルの中に線画アイコン（`ICON_SIZE` 28・`tintColor: colors.brandInk`）。今のホワイトと同じ | 差し替え口を残す |
| 5 | 消すもの | `PanelSurface`・`CARD_HEIGHT`（113）・「COMING SOON」の `RNText`・`WHITE_*` の名前（`PANEL_PADDING` 等の外観に依らない名前に）。`testID="feature-panel-white"` → **`feature-panel`**、`feature-panel-photo` はそのまま | 名前に「white」が残ると嘘になる |
| 6 | グリッド（`index.tsx`） | 触らない（`columnGap`・`rowGap: 12`・幅の実測はそのまま）。**9 枚の順も変えない** | パネルの中身だけ |
| 7 | 高さ | 正方形タイル + ラベル 2 行 + 注記 1 行なので、ピンクの 113 より高くなる（幅 76 なら 76 + 8 + 32 + 14 + 12 = 約 142）。**それでよい。**ホームの下の `ReleaseButton` が下がるだけ | ホワイトで既に成り立っている高さ |
| 8 | `releases.ts`（043 の「新機能のお知らせ」） | **載せない**（人間の指示 2026-09-18）。`conventions.md` の「機能を足したら 1 項目」の例外。バージョンも上げない | 見た目の揃えで、機能ではない |
| 9 | 039 のタスク定義 | A が 5-2 c の記述を「両方の外観」に直した。`architecture.md` のデザイントークンは変わらない | 現在の定義だけ残す |

## 1. B の作業

- `apps/app/components/feature-panel.tsx`: 0節 #1〜#5 の形に。先頭のコメント（020・035・039 の経緯が長い）は**現在の形の説明だけ**に書き直してよい（経緯は git にある）
- `apps/app/test/white-stage2.test.tsx`: 「pink では従来どおり COMING SOON」のテストを反転（T1）。`feature-panel-white` → `feature-panel`
- 画面: `artifacts/062/` にピンクとホワイトのホーム（375 幅）を 1 枚ずつ。9 枚の写真がピンクで出ていること・ホワイトが変わっていないこと

## 2. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | pink で `photo` あり → `feature-panel-photo` が出る。`photo` 無し → 線画アイコンで `feature-panel-photo` は無い。押せないパネルは「近日公開」で「COMING SOON」は無い。使えるパネルには「近日公開」も無い | `apps/app/test/white-stage2.test.tsx`（既存の white の 3 本は `feature-panel` に名前を替えて緑のまま） |
| T2 | `feature-panel.tsx` に `appearance` の読み取りが無い（`useTheme()` から `appearance` を取り出していない。`grep` で固定） | 同上 |
| T3 | ホーム（pink）に `feature-panel-photo` が 9 つ | `apps/app/test/home-screen.test.tsx` |
| T4 | `home-screen.test.tsx` の「COMING SOON・準備中です・次フェーズが出ない」が緑のまま | 既存 |

## 完了条件

- T1〜T4。`pnpm -r test`・型チェック・lint
- 画面 `artifacts/062/`（ピンク・ホワイトのホーム。375 幅）
- `releases.ts` は触らない（0節 #8）
- 本番デプロイ後、人間がピンクのホームを見る
- `state.md` / `worklog.md`

## 停止条件

- ピンクの `surfaceTint`（`#FCEEEC`）の上で写真の縁が浮いて見える（写真は `cover` で正方形いっぱいなので、地は写真が読み込まれるまでしか見えないはず）→ 見えるなら画面を撮って A へ
- レビュー往復 3 回 → A へ

## 順序

061 の後。小さい（部品 1 つとテスト）。iOS 段階0・メール認証の前。
