# 061 段階1 — R の判定

**受け入れ（条件付き）。必須修正 3。コードの論理に必須は無い。足りないのは証跡と記録。**

## 疑ってほしいと言われた 3 点への答え

1. **隠し画面の判定 — 正しい。** `expo-router@57.0.16` の `build/layouts/TabsClient.js`
   15〜35 行を R が自分で開いた。`options` がオブジェクトで `href !== undefined` の
   とき `href` を剥がし、`tabBarItemStyle: { display: 'none' }` と null を返す
   `tabBarButton` に置き換えている。`_layout.tsx` の隠し画面 12 枚は全部その形。
   既定の `BottomTabBar.js` 66〜67 行も `StyleSheet.flatten(tabBarItemStyle).display`
   で判定しているので同じ規則。
2. **テストの前提 — 実物と一致。** `isHiddenFromTabBar` を故意に
   `options.href === null` に戻して走らせたら、赤は「スロットの数が一致する」の
   1 本だけ（申告どおり）。同じ形の穴は他に見つからなかった。ただし「隠し画面は
   タブのボタンとして出さない」は壊れた実装でも通る（記録 3）。
3. **直さなかった 2 件 —** `<a href>` の退行を A に回すのは妥当。**ただし申し送りの
   理由が不完全。** expo-router の公開 `Link` は `useLinkToPathProps` →
   `appendBaseUrl` で `/app` を自分で足す（`build/link/useLinkToPathProps.js` 42 行）。
   4 タブの href は静的なので `<Link href asChild>` で包めば `<a>` に戻せる
   （代わりに部品が実行時に expo-router を読むのでテストにモックが要る）。
   **「直せない」ではなく「直せるが A の判断」に訂正すること。**
   文字列検査の脆さは A に回す話ではない。**R として許容する**
   （`danger-variant-scope.test.ts` と同じ先例。G5 は行が消えれば `toBeDefined` で
   赤く落ちる）。

## 必須修正

### 必須 1: 動作証跡が無い。撮影スクリプトを書く（撮影はローカルで R がやる）

`artifacts/061/` が存在しない。058〜060 は全部画面を置いていた。完了条件から
「画面キャプチャ」が抜けているのが、**定義を自分で書いた副作用。**
クラウドで撮れないのは分かっているので、代行者は次を用意する:

- `artifacts/061/scripts/capture.mjs`: `artifacts/059/scripts/capture.mjs`・
  `artifacts/058/scripts/capture-stage3.mjs` と同じ作法（Playwright chromium・
  390×844・`deviceScaleFactor` 2・`futary.appearance` の localStorage で両外観・
  045 の Cookie）。撮るのはホームとカレンダー（写真や投稿がタブバーの下を通る
  画面）× ピンク／ホワイト。`capture.json` にタブバーの矩形
  （`[data-testid="glass-tab-bar"]` の `getBoundingClientRect`）・FAB の矩形・
  `[role="tablist"]` の子の数・`[role="tab"]` の数を書く。
  **「寸法は変えていない」の証明はこれでしか立たない。**
  可能なら webkit でも 1 枚（屈折の層が捨てられる経路）
- `artifacts/061/stage1.md`: 報告。画面の表は R が撮ったファイル名で埋める前提で
  枠だけ用意してよい

### 必須 2: FAB の縦位置が約 6px 下がる計算。撮る前に直す

旧 `tabBarStyle` の `paddingTop: space.sm`（8px）を外し、項目は `tablist` の
`alignItems: "center"` で上下中央になった。`FabTabButton` は `marginTop: -20` で
上へはみ出す設計。旧: 項目の上端 y=8 から −20 → バーの上に 12px 出る。
新: 包みの高さ 36（56−20）を 64 の中央に置く → 上端は −6。タブの項目・アイコン・
文字の縦位置も 8px 分ずれている。旧と同じ配置に戻す（`tablist` に
`paddingTop: space.sm` を入れて `alignItems` を旧の項目と同じにするのが一番近い）。
計算を疑うなら、それも `stage1.md` に理由付きで書く。R の撮影で 058 の画面
（`artifacts/058/stage3/pink-day-no-event.png`）と並べて確かめる。

### 必須 3: `docs/state.md`・`docs/worklog.md` を PR に入れる

「マージ後に別コミットで記録する運用」は**半分しか合っていない。**
#409・#413・#416 は PR 自体に両方の更新を含み、マージ後の記録はそれとは別。
`CLAUDE.md` の「ファイル変更を伴う作業の完了時は必ず更新」に従う。
`state.md` には「代行セッションが実装した」ことと「A の手番: 5節の申し送り 4 件」
を書く。

## 併せて

- タスク定義 4節「遷移の変更 しない」と 5節「`<a href>` が消えた」が矛盾している。
  定義は退行を自分の言葉で持つこと（4節に「web の `<a>` は消える。5節」と書く）
- R の判定（この全文と、下の記録）を `artifacts/061/review-stage1.md` に保存する

## 記録（判定に使わない）

1. `tabLongPress` を emit しない・`tabBarLabel` を見ない。今の `_layout.tsx` には
   どちらも無い
2. CSP は `img-src data:`・`style-src 'unsafe-inline'` があり、`feImage` の data URI と
   inline style は通る（`security-headers.ts` 56〜57 行）
3. G1 の 1 本目は壊れた実装でも通る。名前を弱めるかスロット数の検査に統合。任意
4. `useBottomTabBarHeight` は使われていない。`navigation.navigate(name, params)` は
   既定の `dispatch(navigate(route))` とこの navigator では同じ結果

## R が確かめていないこと

見た目そのもの・Safari/Firefox の描画・`build:public` の出力に defs が入ること・
iPhone の 60fps と発熱。

---

## 代行者の対応（この判定を受けて）

| 必須 | 対応 |
|---|---|
| 1 | `artifacts/061/scripts/capture.mjs` と `artifacts/061/stage1.md` を用意した。撮影は R |
| 2 | 直した。`tablist` に `paddingTop: space.sm`、`alignItems` を外して stretch に戻し、ピルも同じ枠で中央に置き直した。**項目のずれは計算すると 8px ではなく 4px**（旧 y=36 → 32）。原因と向きは指摘のとおり。数値は `stage1.md` の表 |
| 3 | `state.md`・`worklog.md` を更新した。**「マージ後に別コミットで記録する運用」という主張は誤りだった**（#409・#413・#416 を実際に開いて確認した）。PR 本文も直した |
| 併せて | タスク定義 4節に `<a>` が消えることを明記。5節の申し送りを「直せない」→「直せるが A の判断」に訂正し、`useLinkToPathProps` → `appendBaseUrl` の経路を書いた。記録 3（G1 の 1 本目）も名前を直した |

---

## 撮影の結果（R。条件だった撮影を終えた）: 受け入れ

R がローカルで Chromium・WebKit・Firefox × ピンク・ホワイト × ホーム・カレンダーを撮影・計測した（`artifacts/061/stage1/`。この節は B が R の結果をそのまま置いた）。

- タブバー x=16 y=764 w=358 h=64、下余白 16（旧と同じ）。`tablist` の子 5・`role="tab"` 4
- FAB y=752 h=56 → `fabOverhang` 12（必須 2 の留め金。直す前は 6）。ピル y=778 h=44
- SVG フィルタの定義 2 つとも文書にある。ピンクは色収差の層あり、ホワイトは無し
- 058 の旧タブバーと並べてアイコン・文字・FAB の位置が 1px 以内で一致
- コンソールエラーは従来の 404 だけ。Firefox はフォントの読み込み失敗（061 の外）
- 環境の限界: Playwright の WebKit・Firefox（Windows headless）は `backdrop-filter` を描画しない（最小 HTML で確認）。見た目は Chromium の画面と、人間の iPhone Safari で
- `capture.mjs` の不具合 2 つ（お知らせのモーダル・FAB の枠の role）は R が直し、この PR で差し替えた
