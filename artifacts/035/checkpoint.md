# 035: 見た目を作り込む — 部品ができた時点のチェックポイント

**タスク定義0-2節の停止条件どおり、ここで一度止める。**14画面には進んでいない。

## ここまでで作った部品

| 部品 | 変更内容 |
|---|---|
| `Screen`（`packages/ui/src/components/screen.tsx`） | `expo-linear-gradient`で`gradients.screen`（`bg`→`surface-tint`）を背景に敷いた。ここ1つで14画面の地が変わる |
| `Badge`（新規。`packages/ui/src/components/badge.tsx`） | ピル型バッジ。`tone: "subtle" \| "muted"`。「会った日数：94日」等の主役寄り表示（`subtle`）と控えめな表示（`muted`）の2種。**まだどこからも呼んでいない**（次段のStatsCard個別作り込みで使う想定） |
| `Avatar`（`packages/ui/src/components/avatar.tsx`） | `glow?: boolean`を追加。trueで`shadow.glow`の光るリングが付く（既定false。一覧等で煩雑にならないため） |
| `FeaturePanel`（`apps/app/components/feature-panel.tsx`） | 白いカード化（`surface`地 + `radius.card` + `shadow.card`）。020の「枠線も背景も持たない」判断を覆した（タスク定義2節）。「次フェーズ」→「COMING SOON」に文言変更 |
| ボトムタブ（`apps/app/app/(tabs)/_layout.tsx`） | 画面下端への貼り付けをやめ、左右・下に余白を取ったピル型で浮かせた（`position:"absolute"` + `radius.pill` + `shadow.card`）。中央の＋ボタンは`shadow.glow`で光彩を追加。浮かせた分の下パディング定数を`apps/app/lib/tab-bar-layout.ts`に集約し、ホーム画面（`(tabs)/index.tsx`）に適用した |

新規トークン（`gradients.screen`・`gradients.card`・`shadow.glow`）はAに提案し承認・改名（`avatarGlow`→`shadow.glow`）を受けてマージ済み（PR #234）。`docs/architecture.md`7節に反映されている。

## 入れた依存

`expo-linear-gradient`（`apps/app`・`packages/ui`両方の`package.json`。後者はコンポーネント側で実際に`import`しているため必要）。他は入れていない（`package.json`の差分で確認可能）。

## Web上での確認

`app-web`（Expo web）+`api-dev`をBrowser paneで起動し、ローカルにデモペアを
シード（`pnpm --filter @futary/db seed:local`。既存の仕組みをそのまま使った。
`.dev.vars`に`DEMO_COUPLE_ID=demo-couple`を追加。gitignore対象で未コミット）。
ゲスト（デモ）閲覧でホーム画面を実際に開き、モバイル幅（375×812）・
デスクトップ幅の両方で確認した。

- グラデーションの地が実際に描画される
- 機能パネルが白いカード（角丸・影）になり、「COMING SOON」が正しく出る
- ボトムタブが浮いた状態で表示され、中央の＋ボタンに光彩が付いている
- コンソールにエラーは出ていない（`expo-linear-gradient`未解決エラーは
  Metroのキャッシュが古い依存関係を覚えていたのが原因と判明し、
  `.expo`・metro-cacheを消して解消した）

## まだ手を付けていないもの（次段。個別の作り込み）

- ホームのデモバナー（ピル型化）・記念日カード（`stats-card.tsx`。グラデ地・
  アバターのglow・3段の数字表示・「会った日数」のBadge化）
- サインイン画面（大きなロゴ・タグライン・ボタンの最終配置）
- 残り12画面（部品を通した見た目の確認・タブバー浮遊化に伴う下パディング適用）

## テスト・型チェック・lint

`pnpm --filter @futary/app test`（222件、全緑。「COMING SOON」文言変更に
合わせてhome-screen.test.tsxを1件更新）・`pnpm -r type-check`・
`pnpm -w eslint .`、全て通過。

## 完了条件（このチェックポイント分のみ）
- [x] モックアップがコミットされている
- [ ] **部品ができた時点で人間に見せ、進めてよいと言われた**（このチェックポイントで依頼中）
- [ ] ホーム個別の作り込み
- [ ] サインイン個別の作り込み
- [ ] 残り12画面の通し確認
- [x] 入れた依存が`expo-linear-gradient`だけ
- [x] 足したトークンが`architecture.md`7節に書かれている（Aが記載・PR #234）
- [x] 既存のテストが緑
