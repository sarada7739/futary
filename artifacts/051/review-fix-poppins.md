# 051 fix（PR #359）— R の判定

futary-R で e5df08a を checkout して実行した。app 534 緑・`tsc --noEmit` 緑・`eslint .` 緑。差分は `apps/app/public/fonts/poppins-300.woff2` の削除と `+html.tsx` のコメント 1 行だけ。触ったものは戻した。

**判定: 受け入れ。必須修正なし。**

## 読んで確かめたこと（自分で grep した）

- `git grep poppins-300`（`artifacts`・`docs` を除く）はコメント 1 行だけ。`git ls-files | grep poppins` は 500 と 800 の 2 つ（`apps/api/public` はリポジトリに無い = `expo export` の複製）
- `fontWeight: "300"` / `font-weight: 300` を使う要素は `apps`・`packages` に無い（当たるのは `link-preview` のテスト fixture の Amazon の HTML だけ。無関係）
- `Poppins` を指すのは `packages/ui/src/tokens.ts` の `fontFamily.numeric` だけで、`+html.tsx` の `@font-face` は 500・800 の 2 つ。300 を要求する要素が無いので、無い weight をブラウザが合成する経路も無い
- 回帰テストが書けないという B の理由は妥当（静的ファイルの有無はユニットテストの外。`+html.tsx` の preload/`@font-face` に 300 が無いことは 051 本体で既に外れている）

## 記録（判定に使わない）

- 無し

## 私が確かめていないこと

- デプロイ後の `/app/fonts/poppins-300.woff2` への 404（参照が無いので起きない。起きたらキャッシュされた古い HTML）
