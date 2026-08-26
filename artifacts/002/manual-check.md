# 002 デザイントークンと共通UI: 動作確認記録

## 実施日
2026-08-27

## 手順と結果

### 1. 型チェック / Lint / テスト
```
pnpm run type-check   # 全workspace Done（エラーなし）
pnpm run lint         # eslint . エラーなし
pnpm run test         # packages/ui: 7 passed / apps/api: 1 passed
```
詳細ログ: `test-results.txt`

`packages/ui` の単体テスト（Vitest）は以下を確認している。
- `tokens.test.ts`: 色トークンの値、`radius` の値、`space` が4の倍数で単調増加すること
- `avatar-logic.test.ts`: `Avatar` の頭文字抽出ロジック（`initialOf`）。
  先頭1文字の大文字化、前後空白の除去、空文字時のフォールバック（`?`）、
  日本語1文字の抽出を確認

React Native コンポーネント本体（`Text`/`Button`/`Card`/`Avatar`/`Screen`）は
Vitest 上でのレンダリングテストが react-native のネイティブ依存と相性が悪いため、
ロジック部分（`initialOf`）のみ単体テストに分離し、見た目は本項の実機（ブラウザ）確認で担保した。

### 2. 生の16進カラーの混入確認
```
grep -rn "#[0-9A-Fa-f]{3,6}" packages/ui/src/components/ apps/app/app/
```
→ 該当なし（トークン経由のみで色を参照している）。

### 3. アプリ起動・画面確認（Web）
```
pnpm --filter @futary/app run web    # http://localhost:8081
pnpm --filter @futary/api run dev    # http://localhost:8787
```
→ Metro バンドル成功。Claude Browser（Chrome, Playwright経由でのスクリーンショット）で確認。

- ホーム画面: ロゴ画像・`health.get` の疎通結果（`ok: true` と現在時刻）を表示
- アルバム / 検索: 「準備中です」のプレースホルダーを表示
- 投稿（中央FAB）: タップで投稿タブ（プレースホルダー）に遷移することを確認
- マイページ: `Avatar` コンポーネント（頭文字表示）を表示

### 4. スクリーンショット
- `mobile-home.png`（390×844, スマホ幅）: ホーム画面。ロゴ・カード・タブ・FABの配置を確認
- `mobile-album.png`（390×844, スマホ幅）: アルバム（準備中）画面。タブ選択状態の色変化を確認
- `desktop-home.png`（1280×900, PC幅）: ホーム画面。タブ・FABが横幅いっぱいでも破綻しないことを確認

## 途中でハマった点（メモ）

- `packages/ui/tsconfig.json` を `apps/app` と同じく `expo/tsconfig.base` を
  extends しようとしたが、`packages/ui` は `expo` パッケージに依存しておらず
  pnpm のシンボリックリンク構造上 `expo/tsconfig.base` を解決できなかった。
  `expo/tsconfig.base` の中身（`jsx: react-jsx` 等）を `tsconfig.base.json` の上に
  直接書く形に変更して解決
- 画像 import 用の型宣言を `apps/app/expo-env.d.ts` に書いたが、このファイルは
  `.gitignore` 対象で Expo の dev サーバー起動時に標準内容へ上書き・再生成される
  管理下のファイルだった（書いた `declare module "*.png"` が消えて型チェックが
  再度落ちた）。`apps/app/types/assets.d.ts` を新設してそちらに移し解決
- Chrome を `--headless=new`（および従来の `--headless`）で起動し `--window-size` を
  指定してスクリーンショットを撮ると、指定サイズが無視され実際のビューポートが
  固定で 500×749 になる問題に遭遇した（`window.innerWidth` で確認）。
  この幅だとボトムタブ5つ目（マイページ）が見切れて写り込み、
  「タブが5つ揃って見える／見えない」がヘッドレスの不具合によるものだと切り分けるまで
  レイアウト崩れと誤認しかけた。`pnpm dlx playwright screenshot --channel=chrome`
  （システムの Chrome をチャンネル指定で使用）に切り替えてビューポート指定が
  正しく効くことを確認し、以後のスクリーンショットはこちらで撮影した
- Web 版で `"shadow*" style props are deprecated. Use "boxShadow".` という警告が
  コンソールに出る（React Native Web の仕様）。動作に支障はないため今回は対応せず、
  `shadow` トークンの実装を変える際の注意点として記録のみ
