# 068 追補 4: 縦で開いて横に回したときに 3D にする（と、`?debug3d` を外す）

`docs/tasks/068-phone-3d-tilt.md` の「追補 4」#3〜#5。

## 原因（人間の iPhone の `?debug3d`）

`iphone-debug3d.png`（人間が iPhone の Safari 27.0.1 で撮ったもの）。表示はここで止まっていた:

```
0.63s viewport: 440x736 dpr 3
0.63s phone element: true
0.63s min-width 768: false
```

ページを読んだときは縦向き（幅 440）で、3D の判定を読み込みのときに 1 回しかしていなかった。撮ったときは横向き（2 列のレイアウト）だが、判定し直さないので 2D の枠のままだった。

## 直したこと（`apps/landing/js/phone3d.mjs`）

- `matchMedia("(min-width: 768px)")` の `change` を見る。広くなったとき、まだ組んでいなければ WebGL を確かめて 3D を組む。組んだら（または WebGL が使えないと分かったら）見るのをやめる
- 狭くなったときは何もしない（768 未満は節ごと `display: none`。`IntersectionObserver` が描画を止める）。もう一度広くなれば、組んである 3D がそのまま見える
- 出す条件（幅 768 以上・WebGL が使える）は変えていない。`canUse3D()` は幅を見る役を外して `hasWebGL()` にした
- `?debug3d` の表示（#477）を外した（追補 4 #2）。`phone3d.mjs` は #477 の前と同じ形に戻してから上の直しを入れた

## テスト

`apps/api/test/landing.test.ts` の「068: 「さわってみる」の 3D」に 1 本足した: `phone3d.mjs` が `matchMedia("(min-width: 768px)")` の `change` を見ていて、`debug3d` を含まない（`?raw` で読む）。

## 証跡（追補 4 #5）

`node artifacts/068/scripts/orientation.mjs artifacts/068/stage5 <webkit|chromium>`（先に `pnpm build:public` と api-dev）。端末は Playwright の `iPhone 15 Pro Max`（縦 430×739）と `iPhone 15 Pro Max landscape`（横 814×380）で、画面の大きさを入れ替えて回したことにする。

| # | 確かめたこと | WebKit | Chromium |
|---|---|---|---|
| 1 | 縦で開く: 節が隠れ、3D は組まれていない（CSS3D の層・canvas が 0） | OK | OK |
| 2 | 横にする: 3D になる（`.is-3d`・層 1・canvas 1・iframe は 3D の層） | OK | OK |
| 3 | 横: ふちをドラッグすると傾き（iframe が `matrix3d`・幅が縮む）、離すと正面（2D の変形）に戻る | OK | OK |
| 4 | 縦に戻す: 節が隠れ、組んである 3D はそのまま（層・canvas は 1 つのまま） | OK | OK |
| 5 | もう一度横にする: 3D のまま（層・canvas は 1 つずつ・**iframe の読み直しが 0 回**） | OK | OK |
| 6 | もう一度横: ふちをドラッグすると傾き、離すと正面に戻る | OK | OK |
| 7 | ページのエラーが無い | OK | OK |

両方 3 回ずつ流して 7 / 7（`webkit-orientation-results.json`・`chromium-orientation-results.json`）。

**WebKit の画面は撮っていない（見た目は Chromium で撮った）**: Windows の Playwright の WebKit は、CSS の `perspective` を描かない。最小の例（`perspective(1000px) translateZ(1000px)` の先で z −500 に置いた 100px の箱）で、Chromium は 66.7px（1000 / 1500 倍。計算どおり）、WebKit は 100px のままで位置もずれた。このため WebKit の画面では iframe が本体の穴より大きく、ずれて写る。three.js の `CSS3DRenderer` の問題ではなく、この WebKit が 3D の変形を描かないためと見ている（Mac・iPhone の Safari では確かめていない）。状態（クラス・層・読み直しの回数）は WebKit でも確かめられるので、表の WebKit の列はそれで判定した。

画面（Chromium・同じ端末の設定）: `chromium-orientation-1-portrait.png`（縦。節が無い）・`-2-landscape.png`（横にして正面）・`-2-landscape-tilted.png`（傾けたところ）・`-3-portrait-again.png`・`-4-landscape-again.png`・`-4-landscape-again-tilted.png`。

撮っていて 1 つつまずいた: WebKit は画面の大きさを変えた直後にスクロールの位置を自分で直すことがあり、電話を真ん中に置いたつもりが 191px ずれて、スクロールで決まる斜めの角度のまま（正面にならない）になった。これは定義どおりの動き（追補 3）で、撮る側の問題。真ん中に置く処理を、ずれが 2px 以内になるまで繰り返すようにした。

## 確かめたこと

- `phone3d.js` gzip 165,680 バイト（上限 200KB）
- `pnpm -r test`: ui 23・date 68・db 34・app 630・api 808 = 1,563 緑。type-check・lint 緑

## 確かめていないこと

- 実機の iPhone・iPad（本番デプロイのあとで人間が見る。追補 4 #5）。Safari で本体の穴と iframe が合っているかも、実機で見るまで分からない
