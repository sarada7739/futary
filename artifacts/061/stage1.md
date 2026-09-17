# 061: 下部タブバーを湾曲ガラスにする（CSS）

`docs/tasks/061-glass-tab-bar.md`。新規の部品 1・純粋な計算 1・テスト 2、既存は
`_layout.tsx`・`+html.tsx`・`theme.ts` に触った。**新しいパッケージは足していない。**

**この報告を書いたのは B ではない。**A・R・B が起動しないため、人間の指示で
独立したセッションが B の手番を代行した。ハーネスの外にいる。

## 変更

- `apps/app/components/glass-tab-bar.tsx`（新規）
  - ガラスの板を5層で積む: ぼかし（`backdrop-filter: blur() saturate()`）→ 屈折
    （`backdrop-filter: url()`。対応する engine だけ）→ ガラス板（`filter: url()`）→
    色収差（`inset` の影を左右に振る）→ フチ（`inset` の影と 1px の枠）
  - **ぼかしと屈折を別の層にする。**`backdrop-filter` に `url()` を含めると、
    解釈しない WebKit・Firefox が**宣言ごと**捨て、ぼかしまで消える
  - 選択中のピルは独立したレンズ。`Animated` + `PanResponder` でドラッグ追従・
    スプリング・速さによる横の伸び。`overflow: hidden` の板の外に置いて、押した
    ときにバーからはみ出せるようにしてある
  - 隠し画面は `StyleSheet.flatten(options.tabBarItemStyle)?.display === "none"` で除く
- `apps/app/lib/tab-pill.ts`（新規）: ピルの位置・寄せ先・伸びの計算。描画から切り離した
- `apps/app/app/+html.tsx`: 変位マップ（R に横・G に縦のランプ）と SVG フィルタ2本を
  body の先頭に1度だけ置く。`filter: url(#id)` は同じ文書の定義しか引けない
- `packages/ui/src/theme.ts`: `Glass` トークンを両外観に追加。
  **`colors`・`shadow`・`gradients` は 1 つも変えていない**（T1 の凍結が通る）
- `apps/app/app/(tabs)/_layout.tsx`: 見た目の指定を外し `tabBar` を渡す

## R レビュー必須2 の修正（縦位置）

旧の `tabBarStyle` は `paddingTop: space.sm`（8）を持ち、項目は `tabBarItemStyle: { flex: 1 }`
＋既定の `stretch` で縦に伸びていた。最初の版はこれを `alignItems: "center"` に
置き換えたため、項目が中身の高さに縮み、FAB の `marginTop: -20` の起点が下がった。

| | FAB の上端 | バーからのはみ出し | 項目の中身の中心 |
|---|---|---|---|
| 旧（`paddingTop: 8`・stretch） | y = −12 | 12px | y = 36 |
| 最初の版（`alignItems: center`） | y = −6 | 6px | y = 32 |
| 直した後 | y = −12 | 12px | y = 36 |

**R の指摘どおり FAB は 6px 下がっていた。**項目のずれは R は 8px と書いたが、
計算すると 4px（旧 36 → 32）。原因と向きは R の指摘のとおりで、直し方も同じ。
`tablist` に `paddingTop: space.sm` を入れ、`alignItems` を外して stretch に戻した。
ピルも項目と同じ枠の中で中央に置き直した（`top: 14`。バー全体の中央 `10` では
項目とずれる）。

数値は `artifacts/061/stage1/capture.json` の `fabOverhang` が 12 であることで確かめる。

## テスト

| # | 何を | 結果 |
|---|---|---|
| P1〜P5 | ピルの休む位置・ドラッグの右端・寄せ先・速さによる伸び・`clamp`。スロット幅 0 と項目 0 で NaN にならない | 緑（17 件） |
| P6 | ＋投稿のスロットを指したら本物のタブへ振り替える。同じ距離なら動いていた向きの側 | 緑 |
| G1 | 隠し画面はタブに出ない。**`tablist` の子の数が 5・`role="tab"` が 4**。隠し画面を開いている間はピルを出さない。`tabBarButton`（＋投稿）はその部品が描かれる。アイコンは `tabBarIcon` から引く | 緑（13 件） |
| G2 | 選択中の項目にだけ `aria-selected` が付く | 緑 |
| G3 | `tabPress` を emit し、止められなければ navigate。選択中は navigate しない。`preventDefault` されたら navigate しない | 緑 |
| G4 | ピンク・ホワイトの両方で描ける | 緑 |
| G5 | ぼかしの宣言に `url(` を含めない。屈折は `backdrop-filter` と `filter` の両方に置く | 緑 |
| G6 | `theme.ts` の `filterId` が全部 `+html.tsx` に定義されている | 緑 |
| T5 | `glass` のキーが両外観で同一。`filterId` は外観ごとに別。ホワイトの色収差は 0 | 緑（4 件） |

**全体**: 型チェック・lint・全テスト緑（1531 件）。

### テストが壊れを捕まえることを、故意に壊して確かめた

| 壊し方 | 落ちたテスト |
|---|---|
| ぼかしの宣言に `url()` を混ぜる | G5 |
| `theme.ts` の `filterId` を `+html.tsx` と食い違わせる | G6 |
| 隠し画面の除外を `options.href === null` に戻す | G1 の「スロットの数が一致する」**だけ** |
| 寄せ先の振り替え（`nearestAllowedIndex`）をやめる | P6 |

3 番目が重要。**最初の版は「隠し画面はタブのボタンとして出さない」しか見ておらず、
壊れた実装でも緑だった。**スロットの数を数える検査を足して初めて捕まる。

## ビルド

`pnpm build:public` を通した（exit 0）。出力の `apps/api/public/app/index.html` に
フィルタ2本が `scale="26"`（ピンク）・`scale="12"`（ホワイト）で入り、変位マップの
data URI は `encodeURIComponent` 済みで壊れていない。包みの `div` は
`position:absolute;width:0;height:0;overflow:hidden` で流れの外にある。

## 代行者が確かめていないこと

- **見た目そのもの。**実機もブラウザも開いていない（クラウドのコンテナのため）
- Safari / Firefox での描画。屈折の層が捨てられる経路
- iPhone の 60fps・発熱・LP の iframe（056）の中での重さ
- 撮影（`artifacts/061/scripts/capture.mjs` は用意した。走らせるのは R）

## 撮影の手順（R）

```
node artifacts/061/scripts/capture.mjs http://localhost:8081 artifacts/061/stage1 session-cookie.txt
# webkit・firefox も入っていれば
node artifacts/061/scripts/capture.mjs http://localhost:8081 artifacts/061/stage1 session-cookie.txt webkit
node artifacts/061/scripts/capture.mjs http://localhost:8081 artifacts/061/stage1 session-cookie.txt firefox
```

`capture.mjs` は R が 2 箇所直した版（撮る前に `futary.releaseSeen` を `"3.3.0"`・`futary.weatherPromptDismissed` を `"1"` に置く〈新機能のお知らせのモーダルが画面を覆って `glass-tab-bar` が見つからなかった〉。FAB の枠は react-native-web が `role="none"` を `role="presentation"` で出すので両方で探し、中の `[tabindex]` を測る〈元は `fab: null`、ホワイトでは包みを拾って `fabOverhang: -8` の誤計測〉）。

`capture.json` で見てほしい数値:

| キー | 期待 | 意味 |
|---|---|---|
| `bar.h` | 64 | 高さは変えていない |
| `bottomMargin` | 16 | 画面下端からの余白は変えていない |
| `tablistChildren` | 5 | 隠し画面 12 枚が幅を食っていない |
| `tabCount` | 4 | ＋投稿を除く本物のタブ |
| `fabOverhang` | 12 | 必須2 の回帰。6 なら直っていない |
| `filterDefs` | 2 件とも | 参照が壊れていない |
| `layers.aberration` | ピンク true / ホワイト false | 039「装飾は無い」 |
| `layers.refraction` | chromium true / webkit false | 屈折が効く engine の切り分け |

## 画面（`artifacts/061/stage1/`。R が撮影・計測。390×844・DPR 2。3 エンジン × 2 外観 × 2 画面）

| ファイル | 何 |
|---|---|
| `chromium-pink-home.png` | ホーム（ピンク） |
| `chromium-pink-home-scrolled.png` | 下までスクロールし、カードがバーの下に入った状態 |
| `chromium-pink-bar.png` | タブバーの寄り |
| `chromium-pink-calendar.png` | カレンダー |
| `chromium-white-*.png` | 同じ 4 枚のホワイト |
| `webkit-*.png`・`firefox-*.png` | 同じ 8 枚（寸法・DOM の証拠。下の「環境の限界」） |
| `capture.json`・`capture-webkit.json`・`capture-firefox.json` | 計測値 |

### 計測の結果（R。3 エンジン × 2 外観 × 2 画面の 12 通りすべて同じ）

| 何 | 値 |
|---|---|
| タブバー | x=16 y=764 w=358 h=64、下余白 16（旧 `tab-bar-layout.ts` と同じ） |
| `tablist` の子 / `role="tab"` | 5 / 4（隠し画面 12 枚が幅を食っていない） |
| FAB | y=752 h=56 → `fabOverhang` **12**（必須 2 の留め金。直す前は 6） |
| ピル | y=778 h=44（= 764 + 8 + (56−44)/2） |
| SVG フィルタの定義 | 2 つとも文書にある |
| 層 | ピンクは色収差の層あり、ホワイトは無し。`layers.refraction` は 3 エンジンとも true（層の DOM の有無。描画されるかは別で、`supportsBackdropUrl` も Playwright の WebKit で true を返す） |
| 旧タブバーとの比較 | 058 の `artifacts/058/stage3/pink-day-no-event.png` と並べて、アイコン・文字・FAB の位置が 1px 以内で一致 |
| コンソール | Chromium・WebKit は従来の 404 だけ。Firefox は `downloadable font: download failed`（Poppins）が 6 件（フォントの話。061 の外） |

**環境の限界**: Playwright の WebKit・Firefox（Windows headless）は素の HTML でも `backdrop-filter` を描画しない（R が最小 HTML で確かめた）。この 2 エンジンの画面でバーの下の文字が鮮明なのはそのせいで、実装の問題ではない。寸法・DOM の証拠にしかならない。Chromium では背景が透けてぼける（`chromium-pink-home-scrolled.png`）。Safari の本物のぼかしは人間の iPhone で見る。
