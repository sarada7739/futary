# 033: 0節の確認 — ScrollView horizontal + pagingEnabled は Web で効くか

## 結論

**効く。** react-native-web 0.21.2（`apps/app/package.json`は`^0.21.1`。
実際に解決されたバージョンは`node_modules/.pnpm`配下で0.21.2）で、
`ScrollView`の`horizontal`+`pagingEnabled`はネイティブのCSS
`scroll-snap`にコンパイルされ、実際のブラウザ操作（ドラッグ）でも
ページ境界にスナップすることを実行して確認した。

**`react-native-gesture-handler`・`reanimated`は不要。**追加していない。

## 確かめた手順

### 1. ソースコードで仕組みを確認（読んだだけ。根拠にしていない）

`node_modules/.pnpm/react-native-web@0.21.2.../dist/exports/ScrollView/index.js`
を読むと、`pagingEnabled`は以下のスタイルへ変換されている:

```js
pagingEnabledHorizontal: { scrollSnapType: 'x mandatory' },   // コンテナ
pagingEnabledChild: { scrollSnapAlign: 'start' },             // 各子要素
```

**これだけでは「動く」の根拠にしない**（`harness.md`「実行できる主張は、
実行してから書く」）。以下で実際に動かして確認した。

### 2. 実行して確認（Browser paneでの実測）

`apps/app/app/scroll-test.tsx`（使い捨て。検証後に削除済み）に、
横幅300pxのコンテナへ4枚の300px正方形（赤・黄・緑・青、番号1〜4）を
`horizontal pagingEnabled`のScrollViewで並べた画面を作成。`_layout.tsx`の
`hasCouple`ガード配下に一時的に`Stack.Screen name="scroll-test"`を追加し、
ホーム画面に一時的な遷移ボタンを追加してゲストモード（クライアント側の
Reactの状態のため、フルリロードだと消える。ゲストではじめる→ボタンを
クリックというSPA内遷移でのみ到達できた）から到達させた。
`wrangler dev` + `expo start --web`でBrowser paneから操作。**検証用の
3ファイルへの変更はすべて元に戻し、`scroll-test.tsx`は削除済み**
（このリポジトリに残っていない）。

#### 静的な検証（computed style）

`document.querySelector('[data-testid="scroll-test-container"]')`を
JavaScriptで直接調べた:

```json
{
  "scrollSnapType": "x mandatory",
  "overflowX": "auto",
  "scrollWidth": 1200,
  "clientWidth": 296
}
```

内側の4つの子要素（各ページ）は全て`scrollSnapAlign: "start"`、
幅300pxで並んでいた。ソースコードどおりのCSSが実際にDOMへ適用されている
ことを確認した。

#### 動的な検証（実際にドラッグして送る）

- デスクトップ幅で `scrollLeft = 0` から `left_click_drag`
  （(450,200)→(350,200)。100px分）を実行 →
  `scrollLeft` が **604** になった。ページ境界は0px刻みで
  0/300/600/900（+ボーダー4pxの補正で4/304/604/904）であり、
  **604は3ページ目の境界にきれいに一致した**（中間半端値ではない）
- スクリーンショットで、3ページ目（緑・「3」）が**コンテナいっぱいに
  クリーンに表示**され、隣のページが一切見切れていないことを目視確認
- 続けてドラッグ（(399,200)→ scroll_amount 10のwheel操作）で
  `scrollLeft = 904`（4ページ目=末尾の境界と一致）になることも確認
- `scrollLeft = 0`へ戻したあと、**小さいwheelスクロール（amount 2）は
  動かず0のまま**だった。これは`scroll-snap-type: mandatory`が中途半端な
  位置への移動を許さず、閾値未満の入力を無効化する挙動と整合する

#### 分かったこと・分からなかったこと

- **マウスのドラッグ操作では確実にページ境界へスナップする**ことを実測した
- **合成的なwheelイベント（`computer`ツールの`scroll`アクション）は、
  小さい単位では0のまま動かず、大きい単位では最後まで飛ぶ**という、
  ドラッグとは異なる挙動を見せた。これはブラウザ自動化ツールが発行する
  wheelイベントが実際のトラックパッド操作の運動量（momentum）を再現
  していないためと考えられるが、**確かめていない**（wheel操作の詳細な
  挙動の違いは033の主眼〈タッチでの横送り〉ではないため、ここでは
  深追いしなかった）
- **モバイル幅（375×812）でのタッチ相当のドラッグ操作は、このBrowser
  paneのツールでは安定して実行できなかった**（`left_click_drag`が
  タイムアウトし、`scrollLeft`が0のまま変化しなかった。ツール側の制約と
  考えられる。ページ自体は正しく表示されていた）。**CSS
  `scroll-snap-type`はビューポート幅に依存しないプロパティであり、
  デスクトップ幅での実測結果（3.のドラッグ）がそのままモバイル幅にも
  適用されるはずだが、実機のタッチ操作そのものはこの手段では確認
  できていない。**人間の実機確認が必要（`manual-check.md`参照）

## 0節の判定

タスク定義の3択のうち **「1. Web で効く」に該当。**

「2. 効かないならCSS scroll-snapで代替できるか」「3. どちらも駄目なら
Aへ」は**到達しなかった**（そもそも1で通ったため）。ただし興味深いことに、
**「1」は内部的にすでに「2」と同じ実装だった**（pagingEnabled自体が
CSS scroll-snapへコンパイルされる）。つまり「動くか」の問いに対する
答えは「動く。かつ、その動く仕組み自体がCSS scroll-snapである」。

**中断せず、そのまま先へ進む。**
