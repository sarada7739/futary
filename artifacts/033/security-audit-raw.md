# 033: 複数画像を横にスライド — security-auditorの監査（生ログ）

対象: `apps/app/components/post-images.tsx` / `image-viewer.tsx`、
`apps/app/test/post-card.test.tsx`、検証用に一時変更し既に元へ戻した
`apps/app/app/_layout.tsx` / `apps/app/app/(tabs)/index.tsx`。
031で監査済みのバックエンド（`packages/contract`・`apps/api`）は対象外
（033はフロントエンドのみの変更）。

**High・Medium の指摘はありません。**水平権限昇格（T1）・デモ経路
（T4/T5）・画像URLの露出（T3）に、033が新たに開けた経路はありません。
Low 5件、うち4件をその場で修正しました。

## Low（対応済み）

1. **`index`のクランプが`handleScroll`の中にしか無かった。** `images`が
   将来差し替わる経路ができたとき、範囲外の`index`のまま描画・ボタン判定に
   使われうる状態だった → `safeIndex`（`Math.max(0, Math.min(total-1,
   index))`）を導出し、描画・`goPrev`/`goNext`・カウンター全てで経由させた。
   `images.length`が変わったときにリセットするuseEffectの依存にも追加した
2. **`failedIndexes`（読み込み失敗の記録）が添字キーで、`images`が
   差し替わってもリセットされなかった。** 署名付きURLは1時間で失効するため、
   長時間開いたままにすると同じ添字が「失敗」のまま固定され、新しいURLが
   届いても回復しない経路があった → **添字ではなくURL自体をキーにした**
   （`failedUrls: Set<string>`）。URLが入れ替われば自然に読み込みを
   再挑戦するため、明示的なリセット処理を持たずに済む
3. **デスクトップのマウスドラッグが「閉じる」として誤発火しうる。**
   react-native-webの`PressResponder`は指の移動量を見ずクリックが届けば
   `onPress`を呼ぶ（テキスト選択が起きた場合だけ取り消す）実装だった。
   タッチはブラウザがスクロール後のclickを抑止するため実害が無いが、
   マウスドラッグはネイティブのスクロールを動かさないため、横に送る
   つもりの操作がbackdropの閉じるとして誤発火しうる状態だった →
   **press開始からclickまでの間に`onScroll`が1度でも起きていれば、
   閉じない**ガードを追加した（`scrolledSincePressInRef`）。ブラウザで
   実機確認: 修正前はテキスト上をドラッグすると閉じてしまっていたのが、
   修正後は開いたままになることを確認した
4. **`postImageSchema.url`に形式の制約が無かった。** サーバが発行する
   署名付きURLしか入らない前提だが、防御の深さとして`z.string().url()`
   を追加した（出力スキーマのためoRPCがサーバ側でも検証する）

## Low（記録のみ・対応なし）

5. **一覧行の各アイテムが`accessibilityRole="button"`で`<button>`になり、
   内側にImageの`<div>`+`<img>`を含む。**HTMLの内容モデル上は厳密には
   不正だが、031の入れ子button問題（buttonの中にbutton）とは違い、
   Reactもブラウザも警告を出さない。031の単一画像・グリッドも同じ形で
   あり033の回帰ではない。実害が無いため今回は変更しなかった

## 確認して問題が無かった点（指摘なし）

- **画像URLの露出**: 変更2ファイルで`image.url`が現れるのは`source={{
  uri }}`の2箇所のみ。`accessibilityLabel`・`testID`・`key`のいずれにも
  URLを渡していない。`console.*`・`dangerouslySetInnerHTML`・
  `Linking.openURL`は無い。閉じたライトボックスはDOMからも除去される
  （`animationType`未指定によりModalPortalがアンマウント時にportal divを
  除去することをソースで確認）
- **DOM構造（入れ子button）**: backdropは`accessibilityRole`を持たず
  `<div>`のまま描画され、×・‹・›はその兄弟として`<button>`になる。031の
  問題は再発していない（ブラウザ実測でも確認済み）
- **タップ/ドラッグの誤発火**: 一覧行はタッチのスクロール抑止とマウスの
  「動かなければclickが同一要素に落ちる」性質により安全。ライトボックスの
  無効な矢印ボタンはクリックしても`stopPropagation()`されるため、backdrop
  へは伝播しない
- **状態管理・信頼できないイベント値**: `handleScroll`が読む
  `layoutMeasurement.width`/`contentOffset.x`はreact-native-webが実DOMの
  `offsetWidth`/`scrollLeft`から組み立てた値で、配列添字参照・HTML生成の
  どちらにも使っていないため、範囲外アクセス・XSSの作りこみは無い
- **他ペアの画像への到達性**: `PostImages`/`ImageViewer`は`postId`・
  `imageId`・`coupleId`のいずれも受け取らない。バックエンド・契約・DBに
  033の差分は無い
- **検証用の一時変更の残骸**: `_layout.tsx`・`(tabs)/index.tsx`を通読し、
  検証用のルート登録・遷移ボタン・デバッグ出力のいずれも残っていないことを
  確認した
- **依存の追加**: `react-native-gesture-handler`・`reanimated`の追加は無い

## 補足（セキュリティ指摘ではない）

- 60秒ポーリングでURLが毎回変わるため、ライトボックスを開いたまま1分待つと
  表示中の画像が再ダウンロードされちらつく可能性がある。上記Low-2と同じ
  「URLが毎回変わる」性質から来ており、直すなら同じ場所で直せる（対応済み
  のLow-2で副次的に緩和されている）
- `PostImages`は閉じている間も`ImageViewer`を常時レンダリングするため、
  画像付き投稿1件につき空のportal divが1つ積まれる。017からの既存の性質

修正後、`pnpm -r test`（全パッケージ緑）・`pnpm -r type-check`・
`pnpm -w eslint .`を再実行し、全て通過することを確認した。
