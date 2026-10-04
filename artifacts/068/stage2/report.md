# 068 追補: 人間のモデルに差し替える・傾きの範囲・タッチ（と、画面に出た縞）

`docs/tasks/068-phone-3d-tilt.md` の「追補」と 0節 #2・#4・#7・#8。

## 素材

`docs/sample/fbx/purple smartphone 3d model.zip` を追跡に入れ、`docs/sample/README.md` に行を足した（人間が Tripo の有料プランで作ったもの。公開のサイトで使ってよいことを人間が確かめた）。中身: FBX 1,427,456 バイト（作成ツール Tripo。メッシュ 1 つ・頂点 152,805・インデックス無し・三角形 50,935・幅 0.471 × 高さ 1.0 × 厚さ 0.088）と色のテクスチャ 4096×4096 の JPEG 2,252,243 バイト。

## ロゴを消す（0節 #2）

テクスチャの背面の中央に Apple のロゴ（と影）があった。ほかに他社の印（文字・ロゴ）は無かった（全体を目で見た）。`artifacts/068/scripts/paint-logo.py`: ロゴを囲む箱（1740, 2400)〜(2110, 2830) の中を、箱の縁の色から上下左右の線形補間（Coons の面）で埋めた。背面はなだらかな同じ色なので継ぎ目は出ない。

**R が目で見るための画像**: `texture-no-logo.png`（ロゴを消したテクスチャ全体を 1024px に縮めたもの。右の列の中ほどが背面。ロゴがあった位置は、右の列の真ん中より少し下）。

## GLB に変換して軽くする（0節 #2）

| 段 | 道具 | 大きさ |
|---|---|---|
| テクスチャ | ロゴを消した 4096 → 1024px・JPEG 品質 82（PIL） | 110,039 バイト |
| FBX → GLB | `node artifacts/068/scripts/convert-model.mjs convert <fbx> <texture-1024.jpg> <out.glb>`（three の `FBXLoader` で読み、材質を `MeshStandardMaterial` + 上のテクスチャにして `GLTFExporter` で書く。画像を扱うのに DOM が要るので Playwright の Chromium の中で動かす） | 5,023,348 バイト |
| 頂点をまとめる | `npx @gltf-transform/cli@4 weld` | 1.88MB |
| 面を減らす | `npx @gltf-transform/cli@4 simplify --ratio 0.2 --error 0.001`（三角形 50,935 → **14,015**） | 806KB |
| 量子化 | `npx @gltf-transform/cli@4 quantize`（`KHR_mesh_quantization`。頂点を 16bit の整数で持つだけで、**復号に WebAssembly は要らない**。three の `GLTFLoader` がそのまま読む） | **585,632 バイト・gzip 366,791 バイト**（上限 500KB） |

Draco・meshopt は使っていない（0節 #2）。`--error` を 0.0005 → 0.001 → 0.002 と試し、0.002 では gzip 347KB とわずかしか減らないので 0.001 にした。面を減らした後も、正面・側面の形とボタン・島は崩れていない（下の画面）。

変換で一度つまずいた: テクスチャの `flipY` を `false` にすると、色が別の場所に貼られた。FBX の UV は `flipY = true`（既定）が前提で、`GLTFExporter` が書き出すときに画像を反転して glTF の向きに合わせるので、既定のままにした。

## 画面の位置を測って iframe と合わせる

`node artifacts/068/scripts/measure-model.mjs <phone.glb> <outDir>`: GLB の正面を正射影・光なしで描き（2000px / 単位）、黒い縁の内側を画素で測った。光線（`Raycaster`）で表面の z も測った。

| | 値（モデルの単位） |
|---|---|
| 画面（黒い縁の内側） | 中心 (−0.0008, 0.502)・幅 0.430 × 高さ 0.9645・角の半径 0.065 |
| 画面の表面の z | 0.0437〜0.0439（モデルの最前面と同じ） |
| 画面の上の島 | 中心 y 0.94925・幅 0.124 × 高さ 0.044。z 0.037 で画面より奥に凹んでいる |

- モデルを `K = 390 / 0.430 ≈ 907` 倍にして、画面の幅を iframe の 390（CSS px）に合わせる。画面の縦横の比（0.4458）は iframe の 390×844（0.462）より少し縦長なので、**3D のときだけ iframe を 390×875 にする**（`phone3d.mjs` が `style` で書く。2D の HTML の 390×844 は変えない）。これで縁から iframe がはみ出さず、隙間も出ない。角は `border-radius: 59px`
- 穴は画面と同じ角丸の長方形から、**島の形を抜いた**形（`Shape.holes`）。島はモデルの一部で画面より奥にあるので、抜かないと穴が島ごと消してしまう
- 画面の中心を原点、画面の表面を z = 0 に置き、穴と iframe は z = 0.5（`HOLE_LIFT`）

## 画面に出た縞（人間の報告「角度によってはノイズが映る」）

**原因**: 奥行きの精度不足による z-fighting。カメラの描く範囲が `near = 1`・`far = 距離 × 3` で、本体のある距離（約 1,570）での奥行きの精度が約 0.15 単位しかなかった。#465 の本体は、黒い縁の板（z + 0.2）と穴（z + 0.4）が 0.2 しか離れておらず、角度によって三角形ごとに前後が入れ替わり、縁の黒が iframe の上に縞として出ていた。

**直したこと**: 描く範囲をモデルのまわりに詰めた（`near = 距離 − 0.6K`・`far = 距離 + 0.6K`。精度は 1,000 倍ほど良くなる）。穴には `polygonOffset`（factor −1・units −4）を付け、画面の表面と競らないようにした。本体を差し替えたので、黒い縁の板そのものも無くなった。

**確かめたこと**: `artifacts/068/scripts/angles.mjs` で上下・左右を組み合わせた 4 つの傾き（右下・右上・左下・大きく右）を撮った（`angles-1280.png`）。どれにも縞は無い。

## 傾きの範囲とタッチ（0節 #4）

- `tilt.mjs`: `MAX_TILT_Y` 0.7 → **1.4**（約 80°。π/2 未満なので裏面は見えない）。`rotateX` は ±0.5 のまま
- `tiltFromDrag(start, dx, dy, { yOnly })`: タッチ（`pointerType === "touch"`）は `yOnly` で、縦の動きでは x を変えない
- `style.css`: `.phone.is-3d` を `touch-action: none` → **`pan-y`**（縦のスワイプはページのスクロール）

## 色と光（0節 #3。1280 幅で見て決めた値）

モデルの材質は GLB のまま（色のテクスチャ）で、`metalness` 0.35・`roughness` 0.45 に上書きした（環境マップが無いので、金属感を強くすると暗く沈む）。`AmbientLight(0xffffff, 1.4)`・`DirectionalLight(0xffffff, 2.4)` を (400, 600, 900) から。紫が LP の淡いピンクの地に浮く。

## 読み込み（0節 #7・#8）

- `phone3d.js` は gzip **166,219 バイト**（上限 200KB）。コードで組んだ本体の代わりに `GLTFLoader` が入った（+20KB）
- 2 段のまま: すぐ CSS3D の層に iframe を移し、節の 400px 手前で WebGL を作って `/assets/phone.glb` を読む。**読めなければ 2D に戻す**（iframe を元の場所へ戻し、層を外す）
- `/assets/phone.glb` は `build-public.mjs` が `apps/landing/assets/` ごと写す。GLB の中の画像は `GLTFLoader` が blob: で読むので、CSP の `img-src ... blob:` の範囲（CSP は変えていない）

## テスト

- `phone3d-tilt.test.ts`: 上下限を y ±1.4 に・`yOnly` の 1 本を足した（8 本）
- `landing.test.ts`: `touch-action: pan-y`・`phone.glb` が gzip 500KB 以下（`virtual:landing-assets` に `.glb` の `gzipBytes` を足した）
- `build-public.test.ts`（T3）: そのまま緑（現れる URL は 2 つのまま）
- T4（`node artifacts/068/scripts/capture.mjs artifacts/068/stage2`。`pnpm build:public` → `api-dev`）: **9 / 9 OK**（`capture-results.json`）。前の 7 項目に「上限まで傾けると画面の幅が大きく縮む（約 80°）」と「タッチの縦のスワイプはページがスクロールし、傾かない」を足した

`pnpm -r test`: ui 23・date 68・db 34・app 630・api **799** = **1,554**。type-check・lint 緑。audit の high は無視リストだけ。

## 画面（`artifacts/068/stage2/`）

`front-1280.png`（正面）・`tilted-1280.png`（傾けたところ）・`tilted-tab-1280.png`（傾けたままカレンダーを押したところ）・`tilted-80-1280.png`（約 80°）・`returned-1280.png`（戻ったところ）・`angles-1280.png`（4 つの傾き。縞が無いこと）・`phone-767.png`・`reduced-motion-1280.png`・`texture-no-logo.png`

## 確かめていないこと

- Safari（Mac・iPad）・Firefox。実機のタッチ（CDP のタッチで代えた）
- 人間の PC（Windows の「アニメーション効果」がオフ）では、`prefers-reduced-motion: reduce` になるので 2D のまま（0節 #6 のとおり）。3D を見るには設定をオンにする
