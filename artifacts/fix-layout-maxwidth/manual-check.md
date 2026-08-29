# L59: 画面の最大幅制約（`layout.maxWidth`）の確認記録

2026-08-30実施。設計（`architecture.md` 7節「レイアウト」）どおり、
`packages/ui`の`Screen`が既定で`layout.maxWidth`（640px）を適用する形に
実装した。`packages/ui/src/tokens.ts`にトークンを追加し、
`packages/ui/src/components/screen.tsx`のSafeAreaViewの内側に
`maxWidth: layout.maxWidth, width: "100%", alignSelf: "center"`を持つ
`View`を1つ挟む形にした。opt-outは`unconstrained`プロパティ（既定`false`）。
現時点でこのプロパティを使う画面は無い（017は`Screen`自体を経由しないモーダルの
ため対象外。`architecture.md`7節に明記済み）。

## 確認したこと

- `pnpm run type-check`・`pnpm run lint`・`pnpm run test`すべて緑
  （apps/api 131件・apps/app 28件）
- ブラウザ（Chromium、ビューポート1280×900）でサインイン画面
  （`(auth)/sign-in.tsx`。`Screen`を使う画面のうち認証不要で確認できるもの）を
  実際に開き、`getComputedStyle`でScreen直下の要素が`maxWidth: 640px`・
  `width: 640px`に制約されていることを実測で確認した
- ビューポート375×812（モバイル幅）でも表示崩れが無いことをスクリーンショットで確認
  （画面幅がmaxWidthより小さいため制約自体は効かず、既存の見た目のまま）

## 確認できていないこと

- **認証必須の画面**（タイムライン・投稿作成等）でのPC幅の見た目は、Google
  ログインを要するため今回は確認していない。次の017（画像の全画面表示）の
  実装完了後、L59・017をまとめて人間の実機確認1回で回収する方針
  （Aの判断。PC幅の見た目に関わる変更をまとめることで人間に2回頼まずに済む）
