# 035: 視覚仕様4節（ボケ画像・カード半透明・影）の実装結果

## ボケ画像

`docs/sample/mockup/signin.jpg`のy260〜560px（幅853px全体）を切り出し、
`docs/sample/bokeh.png`として保存した（出自は`docs/sample/README.md`に
Aが記載済み）。実際に使う`packages/ui/assets/bokeh.png`にも同じものを
配置した（`docs/sample/`は原本置き場・`packages/ui/assets/`は使用場所、
という既存の使い分けに合わせた）。

`Screen`（`packages/ui/src/components/screen.tsx`）の最背面
（`gradients.screen`のグラデーションの上）に、`resizeMode:"cover"`・
`opacity:0.5`・画面上部0〜420ptで敷いた。**Screen1箇所の変更のため、
サインイン画面を含む全画面に効く**（実際にサインイン画面を撮影し、
効いていることを確認した。`step4-signin-mobile.png`）。

**ホーム画面では記念日カードがこの420ptの範囲のほとんどを覆うため、
効果が視認しにくい**（`step4-mobile.png`）。サインイン画面では上部が
広く空いているため、効果がはっきり見える。素材自体も強いボケの粒ではなく
淡い光のにじみのため、控えめな効き方になる（過剰に足さない、という
仕様4節の「撒きすぎると安くなる」の方針とも合う）。

## カードの半透明・上端の縁

記念日カードの`CardShell`は1節の実装時点で既に`surface opacity 0.6`・
上端1ptの縁`surface opacity 0.8`にしてあり、追加の変更は無い。

## `shadow.card`

1〜3節の実装時点で既に`0.08/24/y8/elevation4`に変更済み
（`architecture.md`7節はA記載済み）。追加の変更は無い。

## テスト

`pnpm --filter @futary/app test`（222件緑）・型チェック・lint、全て通過。
