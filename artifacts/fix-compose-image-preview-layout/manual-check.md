# fix/compose-image-preview-layout — 手動確認

実行日: 2026-08-29 / セッションB
発見経緯: 人間が実機（Google OAuthログイン済み、`wrangler dev --remote`）で
008/009のM2受け入れ確認を行った際に発見・報告した。

## 観測した事象

投稿作成画面（`compose.tsx`）で画像を選ぶと、画像プレビューが画面の高さを
超え、下にあるはずの「投稿する」ボタンが画面外に押し出されてタップできなく
なっていた（縦長の画像で顕著）。スクリーンショットは人間から共有された
チャット添付のため、このディレクトリには保存していない。

## 原因

`compose.tsx`の本文・画像プレビュー・投稿ボタンが単一の`View`（`flex: 1`）に
並んでおり、スクロール機構が無かった。画像プレビューは`width: "100%"` +
`aspectRatio`（元画像の縦横比）で高さが決まるため、縦長画像だと画面の高さを
簡単に超える。react-native-web はデフォルトでオーバーフロー時にスクロールを
提供しないため、投稿ボタンごと画面外に押し出されていた。

## 再発を防ぐ手段

本文・画像プレビューを`ScrollView`に入れ、投稿ボタンは画面下部に固定する
構成に変更した。画像プレビューにも`maxHeight: 400`を設定し、極端に縦長の
画像でもプレビュー自体が画面を圧迫しすぎないようにした
（`resizeMode`も`cover`から`contain`に変更し、高さが制限されても画像全体が
見える形で収まるようにした）。

自動テストとしての回帰テストは追加していない。react-native-web + jsdom の
結合テスト環境ではレイアウトの実サイズ（画像の実測ピクセル高さが画面を
超えるかどうか）を検証できないため、`apps/app/test/home-timeline.test.tsx`
の既存パターンでは再現できない。目視確認（人間の実機確認）に依存する。

## 影響範囲

`compose.tsx`1ファイルのみの変更。他の画面（`post-card.tsx`等）は元々
`ScrollView`を持つ`FlatList`内で描画されており、この問題の対象外。

## 動作確認

人間が実機（`wrangler dev --remote`、Google OAuthログイン済み）で、修正後の
画面で画像付き投稿ができ、投稿ボタンに到達できることを確認した
（縦長画像を含む複数の画像で確認）。

## テスト・型チェック・lint

- `pnpm --filter @futary/app run test`: 27件すべて緑（009マージ後のmainベース）。詳細は`test-results.txt`
- `pnpm --filter @futary/app run type-check`: 通過。詳細は`type-check-results.txt`
- `pnpm lint`: エラーなし。詳細は`lint-results.txt`
