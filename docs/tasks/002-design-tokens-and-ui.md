# 002: デザイントークンと共通UI

## 目的
色・余白・角丸をトークンとして1箇所に集約し、以降の全画面がそれを使う状態にする。
先にこれを作らないと、各画面に生の16進カラーが散る。

## 変更対象ファイル
- （新規）`packages/ui/tokens.ts` — 色・余白・角丸・影
- （新規）`packages/ui/components/` — `Text` / `Button` / `Card` / `Avatar` / `Screen`
- （新規）`apps/app/app/_layout.tsx` — ボトムタブの骨格
- （新規）`apps/app/assets/logo.png` — ロゴ画像

## 実装内容
- `docs/architecture.md` 7節のトークンをそのまま `packages/ui/tokens.ts` に落とす
- 共通コンポーネントを作る。いずれもトークンのみを参照し、生の色を持たない
  - `Text`（サイズと色をトークンから選ぶ）
  - `Button`（primary / ghost の2種、押下時の色変化あり）
  - `Card`（白地・角丸20・極薄の影）
  - `Avatar`（円形、画像なしの場合は頭文字）
  - `Screen`（背景色と安全領域を担う画面ラッパ）
- ボトムタブ5つ（ホーム / アルバム / ＋投稿 / 検索 / マイページ）を配置する
  - 中央の「＋投稿」は円形の FAB として浮かせる
  - **アルバム と 検索 は「準備中」表示のみ**（MVP スコープ外）
- ロゴのスクリプト体は画像アセットとして配置する（Web フォントを読み込まない）

## 確認観点
- 生の16進カラーがコンポーネント内に1つも無いか（`#` で grep して確認できるか）
- スマホ幅とPC幅の両方でタブとFABの配置が破綻しないか
- `docs/sample/sample.png` と並べたとき、色と余白の印象が一致しているか

## 完了条件
- [x] トークンが `packages/ui/tokens.ts` に集約されている
  ※実際の配置は `packages/ui/src/tokens.ts`。`packages/contract`・`packages/db` と
  同様に `main`/`types` が `./src/index.ts` を指す構成に揃えた（実装メモに詳細）
- [x] 共通コンポーネント5種が動く
- [x] ボトムタブとFABが表示される
- [x] テストが緑
- [x] `artifacts/002/` にスクリーンショット（スマホ幅・PC幅の両方）を保存

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション
- ロゴ画像の用意（論点L2）で詰まった場合は、暫定でテキストロゴを置いて先に進め、`state.md` に記録する

## 進捗
- [x] トークン定義
- [x] 共通コンポーネント
- [x] ボトムタブ + FAB
- [x] ロゴアセット
- [x] 証跡保存 → `state.md` 更新 → `worklog.md` 追記

## 実装メモ（Rレビュー向け）
- ブランチ: `task/002-design-tokens-and-ui`
- `packages/ui` は `packages/contract` / `packages/db` に合わせて
  `src/` 配下にソースを置き、`main`/`types` を `./src/index.ts` にした
  （タスク定義の `packages/ui/tokens.ts` という直下パスとは異なる配置）
- コンポーネントは `packages/ui/src/components/` に `text.tsx` / `button.tsx` /
  `card.tsx` / `avatar.tsx` / `screen.tsx`（ファイル名は規約通り kebab-case）。
  `avatar.tsx` の頭文字抽出ロジックだけ `avatar-logic.ts` に分離してテストしている
  （react-native 本体は Vitest 上でのレンダリングが難しいため、ロジックのみ単体テスト化し、
  見た目は `artifacts/002/` のスクリーンショットで担保する方針にした）
- ボトムタブは `apps/app/app/(tabs)/` にルーティンググループとして実装
  （既存の `apps/app/app/index.tsx` は `(tabs)/index.tsx` へ移動し、ホーム画面として流用）
  - `apps/app/app/(tabs)/_layout.tsx` が `expo-router` の `Tabs` を使ってタブを定義
  - 中央の投稿タブは `tabBarButton` を丸い `Pressable` に差し替えて FAB化
  - アイコンは `@expo/vector-icons` 等を追加導入せず、絵文字1文字で代用
    （依存追加はタスクスコープ外と判断）
- ロゴ: `docs/sample/sample.png` からロゴ部分（"futary" のスクリプト体 + ハート）を
  切り出して `apps/app/assets/logo.png` として配置（論点L2 対応）
- `packages/ui/tsconfig.json` は `expo/tsconfig.base` を extends できない
  （`packages/ui` は `expo` に依存しないため pnpm のシンボリックリンクで解決不可）ので、
  その中身を直接 `tsconfig.base.json` の上に足す形にした
- 画像 import 用の `declare module "*.png"` は `apps/app/expo-env.d.ts`
  （Expo dev サーバーが上書き管理するファイル）ではなく
  `apps/app/types/assets.d.ts` を新設してそこに置いた
- 詳細は `artifacts/002/manual-check.md` の「途中でハマった点」を参照

### レビュー往復1回目（Rの指摘への対応）
- R-7（ロゴ画像の背景が地の色と一致していない）: 対応済み。
  当初は矩形のまま切り出して採用していたが、`docs/sample/sample.png` の背景自体に
  微妙なムラ・ノイズがあり、地の色（`#FEF6F3`）と実測で一致していなかった。
  ロゴ部分を彩度（RGBのmax-min、いわゆるchroma）ベースでマスクし直し、
  背景ノイズ（chromaが低い領域）を完全に透明化、文字とハートの線（chromaが高い領域）
  だけを残す透過PNGとして再生成した。画面の地色とロゴ透明部分の色が
  ピクセル単位で一致すること（`(254,246,243)` で完全一致）を実測で確認した
  （`artifacts/002/test-results.txt` 末尾）
- R-8（余白がトークンを経由していない）: 対応済み。指摘箇所5件すべてを
  `space` トークン経由に変更した。トークンに無い値（FABの直径56、タブバーの高さ64、
  タブラベルのフォントサイズ11、FABの `marginTop: -20`、ロゴの表示サイズ106×58）は
  「この1箇所でしか使わないコンポーネント固有の寸法であり、`space`（余白）や
  `Text` の `size`（本文フォントサイズ）とは性質が異なる」と判断し、
  トークン化は見送った
- R-9（`packages/ui` のテストが型チェックされていない）: 対応済み。
  `packages/ui/tsconfig.json` の `include` に `test` を追加し、`rootDir` を `.` に変更した
  （`apps/api/tsconfig.json` と同じ構成に揃えた）
