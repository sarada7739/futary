# 068 追補 2: 上の島を消す・画質・動きを減らす設定・読み込み中の見え方・元の ZIP（と、残っていた点）

`docs/tasks/068-phone-3d-tilt.md` の「追補 2」と 0節 #3・#6。#469（追補）のマージ（main 46240f6）の記録もこの PR に含める。

## #1 画面の上の島を消す

穴の形から島を抜くのをやめた（`buildHole()` が角丸の長方形だけ）。モデルの島は画面より奥に凹んでいる（z 0.037）ので、穴で覆われて iframe が上端まで見える。`front-1280.png`: デモの帯「これはデモです。ログインで記録を残せます」が全部見える。

島を消したあと、島の輪郭のあったところに点が薄く残った。WebGL の層を隠すと消えるので WebGL から出ていた（`dots-compare.png` の作り方は `scripts/dots.mjs`）。島のまわりの面の z を光線で細かく測ると、一番手前でも画面の表面と同じ高さ（0.04393）で、穴の方が手前にあった。奥行きの判定に頼るのをやめ、**穴は `depthTest: false`・`renderOrder: 1`（本体の後で上書き）**にした。本体は凸で画面は最前面なので、正面が見えている間に本体が画面の手前をふさぐことは無く、上書きしてよい。`dots-compare.png`（上: WebGL あり・下: WebGL を隠したもの）は同じ見え方になった。4 つの傾き（`angles-1280.png`）にも縞・点は無い。

## #2 画質

**原因**: `CSS3DRenderer` は iframe を `matrix3d` と `perspective()` で描く。Chromium は 3D の変形を持つ層を等倍で描いてから GPU で縮めるので、0.8 倍に縮めた文字がにじむ。2D の `scale(0.8)` は縮めた大きさで描くのでにじまない。

**直したこと**: **正面で止まっているとき（傾き 0 でドラッグしていない）だけ、iframe を同じ位置・大きさの 2D の変形（`translate` + `scale`）に置き換える**。位置は 3D で描いた直後の `getBoundingClientRect()` から取り、整数の画素に丸める。傾け始めたら 3D の文字列に戻してから描く（`CSS3DRenderer` は書いた文字列を覚えていて、同じなら書き直さないので、戻してからでないと食い違う）。穴（WebGL）の位置は変わらない（ずれは 1px 未満）。傾けている間は 3D のままで、少しぼやけるのは定義のとおり受け入れる。

**測った値**（`node artifacts/068/scripts/sharpness.mjs <outDir> <deviceScaleFactor>`。同じホームの画面の記念日のカードのあたりを切り出し、ラプラシアンの分散で数えた。大きいほどくっきり）:

| deviceScaleFactor | 2D（今までの枠） | 3D 正面・直す前 | 3D 正面・直した後 |
|---|---|---|---|
| 1 | 1,334.8 | **227.5** | **1,290.4** |
| 2 | 666.8 | 344.4 | 629.2 |

**拡大図**: `sharpness-zoom.png`（同じ範囲を 3 倍・最近傍。上から 2D・3D 直す前・3D 直した後）。直す前は名前の「ゆい」「れん」と顔がにじみ、直した後は 2D と同じように読める。T4 に「止まっているときは iframe の変形が `matrix(…)`（2D）・傾けている間は `matrix3d(…)`」を足した。

## #3 動きを減らす設定

`canUse3D()` から `prefers-reduced-motion` の条件を外した（3D は出す）。離したとき、この設定なら傾きをすぐ 0 にする（正面へ戻る途中の角度が無い）。ドラッグは本人が動かす操作なのでそのまま。T4 を反転した: 「`prefers-reduced-motion: reduce` でも 3D になり、離すと 0.12 秒で正面（`reduced-motion-1280.png`）」。

人間の PC は Windows の「アニメーション効果」がオフ（`prefers-reduced-motion: reduce`）なので、これで 3D が見える。

## #4 モデルを読んでいる間

iframe は読み直しを避けるため最初に CSS3D の層へ移すが、**本体が読めるまでは描かず、`.is-3d` も付けない**。iframe は 2D の CSS（左 107・上 59・`scale(0.8)`）のまま、`.phone-frame` に `z-index: 1` を付けて枠の絵を上に重ねる。見た目は 2D の枠と同じ。モデルが読めたら iframe をモデルの画面の大きさ（390×875）にし、`.is-3d` を付けて 3D に切り替える。読めなければ今まで通り 2D に戻す。

途中で 1 つつまずいた: `CSS3DRenderer` は描くときに初めて iframe を自分の層へ移すので、描くのを待つと iframe が元の場所に残り、読めたときに移って読み直しになった。最初に自分で層へ移す（`cameraElement.appendChild(iframe)`）ようにした。

T4 に「`phone.glb` を 3 秒遅らせると、その間は枠の絵が見え・`.is-3d` が無く・iframe は 3D の層にある。読めたら枠の絵が消えて `.is-3d`」を足した（`loading-1280.png`）。

## #5 元の ZIP

`git rm --cached "docs/sample/fbx/purple smartphone 3d model.zip"`（追跡から外した。ファイルは手元に残してある）。過去のコミットの履歴は書き換えていない。README は A が直した。

## 確かめたこと

- T4（`node artifacts/068/scripts/capture.mjs artifacts/068/stage3`）: **11 / 11 OK**（`capture-results.json`）。読み込み中・画質（2D の変形）を足し、reduced-motion を反転した
- `phone3d.js` gzip 166,366 バイト（上限 200KB）
- `pnpm -r test`: 1,554 緑（数は変わらない）。type-check・lint 緑

## 画面（`artifacts/068/stage3/`）

`front-1280.png`・`tilted-1280.png`・`tilted-tab-1280.png`・`tilted-80-1280.png`・`returned-1280.png`・`angles-1280.png`・`loading-1280.png`・`reduced-motion-1280.png`・`phone-767.png`・`sharpness-zoom.png`・`dots-compare.png`

## 確かめていないこと

- Safari（Mac・iPad）・Firefox・実機のタッチ。Safari は 3D の層の描き方が違うので、画質の直し方が同じように効くかは見ていない
