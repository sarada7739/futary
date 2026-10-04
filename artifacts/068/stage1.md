# 068: LP の「さわってみる」のスマホを 3D にし、ふちのドラッグで傾ける（中のデモは触れるまま）

`docs/tasks/068-phone-3d-tilt.md`。

## 置いたもの

| ファイル | 中身 |
|---|---|
| `apps/landing/js/phone3d.mjs` | 入口。0節 #1〜#6・#8。three.js を import する |
| `apps/landing/js/tilt.mjs`（+ `tilt.d.mts`） | 傾きの純粋な関数（`tiltFromDrag`・`decayTilt`・`isAtRest`・上下限の定数）。DOM・three.js に触らない |
| `scripts/build-public.mjs` | `bundlePhone3d()`（esbuild で 1 ファイル・圧縮・ESM）を足し、`apps/api/public/phone3d.js` に書く。gzip が 200KB を超えたらビルドを止める |
| ルートの `package.json` devDependencies | `three` ^0.186.1・`esbuild` ^0.28.2（束ねるのはルートの `scripts/` なので、依存もルートに） |
| `apps/landing/index.html` | 節「さわってみる」の末尾に `<script type="module" src="/phone3d.js"></script>` の 1 行（とコメント）。HTML の形は変えていない |
| `apps/landing/style.css` | `.phone.is-3d`（cursor・touch-action）・枠の絵を消す・iframe の 2D の位置を打ち消す・2 層の重ね |
| `eslint.config.js` | `apps/landing/js/**/*.mjs` に browser の globals |

## 束ねた大きさ（0節 #7）

`phone3d.js` 569,522 バイト・**gzip 145,967 バイト**（上限 204,800）。three.js から使う部分だけ（esbuild の tree shaking）。本文に現れる URL は `http://www.w3.org/1999/xhtml`（名前空間）と `https://jcgt.org/published/0007/04/01/`（three.js のシェーダーの注記の文献）だけで、読み込み先ではない。CDN・importmap・`import()` は無い。

## 組み方（0節 #1・#2・#3）

- 下の層: `CSS3DRenderer` に**既存の iframe をそのまま** `CSS3DObject` で入れる（2 つ目は作らない）。上の層: `WebGLRenderer`（`alpha: true`。CSS で `pointer-events: none`）。同じ `PerspectiveCamera`（fov 35°。正面で 1 単位 = 0.8px になる距離。2D の `scale(0.8)` と同じ大きさ）
- 本体: `RoundedBoxGeometry` 430×884×40（角 33）。画面の黒い縁・**画面の穴**（角丸 48 の `ShapeGeometry` 390×844・`opacity: 0`・`NoBlending`）・ピル型の島（`CapsuleGeometry`）・側面のボタン 3 つ（左 2・右 1）・背面のカメラの出っ張りとレンズ 3 つ。iframe も `border-radius: 48px` で穴の角に合わせた
- **色と光（B が 1280 幅で見て決めた値）**: 本体 `MeshStandardMaterial({ color: 0x8a8a94, metalness: 0.6, roughness: 0.35 })`・縁と島 `0x0b0b0d`（metalness 0.2・roughness 0.5）・`AmbientLight(0xffffff, 1.6)`・`DirectionalLight(0xffffff, 3)` を (400, 600, 900) から。最初の `0x3a3a40`・1.1・2.2 は環境マップの無い金属が暗く沈み、ほぼ黒に見えたので明るくした
- 画面の上の島は、デモの帯「これはデモです。ログインで…」の文字に重なる。2D の枠の絵（056）の切り欠きも同じ位置で重なっている（`reduced-motion-1280.png`）ので、2D と同じ扱いにした

## 動き（0節 #4〜#6・#8）

- ドラッグは `.phone`（ステージ）の `pointerdown` から。画面の上の操作は iframe が受けるので、ふち・余白からだけ始まる。押した指（`pointerId`）だけを追う。傾き x ±0.5・y ±0.7 rad。離すと `decayTilt`（指数の減衰。0.6 秒で 1%）で正面へ。`cursor: grab` / `grabbing`、`touch-action: none`
- 描画のループは**見えている間（`IntersectionObserver`）かつ動いている間だけ** `requestAnimationFrame`。止まると描かない
- 出す条件: `(min-width: 768px)` かつ WebGL が使える（調べるのに作った文脈は `WEBGL_lose_context` ですぐ手放す）かつ `prefers-reduced-motion: reduce` でない。満たさなければ何もしない（HTML のままの 2D の枠と iframe）
- **読み込みの時機（0節 #8）の実装**: `<script type="module">` は HTML を止めずに読まれ、最初の表示を遅らせない。モジュールは 2 段で動く:
  1. すぐ: CSS3D の層を組み、iframe をそこへ移す。**iframe は DOM の中で動かすと読み直しになる**ので、`loading="lazy"` の読み込みが始まる前（節が見える前）に移す
  2. 節が `rootMargin: 400px` に入ったとき: WebGL の本体を作る（重い方）
  - 0節 #8 の「`import()` で読む」は、外部の JS を 1 ファイルにする（0節 #7）と両立しない（`import()` で読む先が 2 つ目のファイルになる）ので、上の形にした。ファイルは最初に読まれるが、実行は軽い 1 段目だけ

## T1〜T5

- **T1**（`landing.test.ts`）: `/` の `<script` は `<script type="module" src="/phone3d.js">` の 1 つだけ・importmap が無い・`/tech` は 0・`<iframe` は 1 つのまま。054 T2・056 T5 の「`<script` が無い」をこの形に改めた（054 の 0節 #13 は A が改めた）。068 の 2 本（script は節の中・枠の絵は残る／3D のときの CSS）
- **T2**（`phone3d-tilt.test.ts`・7 本）: ドラッグ量 → 角度・押した時点に足す・上下限で止まる・時間で 0 に近づき符号は変わらない・0.6 秒で 1%・フレームの刻みに依らない・dt が 0 や負なら動かない
- **T3**（`build-public.test.ts`・2 本）: 本番と同じ `bundlePhone3d()` を vitest の設定側（Node）で走らせた結果を仮想モジュール `virtual:phone3d-bundle` で渡す（テストは workerd で esbuild が無い。054 の `virtual:landing-assets` と同じ形）。gzip ≤ 200KB・現れる URL は上の 2 つだけ・`import(` が無い
- **T4**（`node artifacts/068/scripts/capture.mjs artifacts/068`。`pnpm build:public` → `api-dev`）: **7 / 7 OK**（`capture-results.json`）

  | 確かめたこと | 結果 |
  |---|---|
  | 1280 幅で 3D になる（canvas がある・枠の絵が消える） | iframe の外接の矩形 316×684 |
  | ふち（ステージの左の余白）をタッチで押さえて引くと傾く | 289×707 に変わる |
  | **傾けたまま iframe の中のタブ「カレンダー」をマウスで押すと、デモが `/app/` → `/app/calendar` に変わる** | 変わった |
  | 押している間も傾いたまま（マウスでは傾きが動かない） | 289×707 のまま |
  | 離すと正面に戻る（1.2 秒後） | 316×684 |
  | 767 幅では節が出ない・3D も組まない | 節は非表示・canvas 0 |
  | `prefers-reduced-motion: reduce` では 2D の枠のまま | canvas 0・`.is-3d` 0・枠の絵が見える |

  画面: `front-1280.png`（正面）・`tilted-1280.png`（傾けたところ）・`tilted-tab-1280.png`（傾けたままカレンダーを押したところ）・`returned-1280.png`（戻ったところ）・`phone-767.png`・`reduced-motion-1280.png`
- **T5**: `canonical-host.test.ts`（053 T4b・056 T1 の CSP）は緑のまま。CSP は変えていない（`/phone3d.js` は `script-src 'self'` で通る）。ブラウザのコンソールにエラー 0（内蔵ブラウザで確かめた。ただしこのブラウザは `prefers-reduced-motion: reduce` なので 2D の側）

`pnpm -r test`: ui 23・date 68・db 34・app 630・api **796**（+13）= **1,551**。type-check・lint 緑。audit high は無視リストだけ。

## 確かめていないこと（人間の手番）

- 本番デプロイ後、PC の Chrome で触る
- **Safari（Mac）**: `CSS3DRenderer` と iframe の組み合わせは Safari で描き方がずれることがある（停止条件）。B の手元に Safari は無い
- Firefox（Playwright の Firefox は使っていない）
