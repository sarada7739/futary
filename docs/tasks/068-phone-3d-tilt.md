# 068: LP の「さわってみる」のスマホを 3D にし、ふちのドラッグで傾ける（中のデモは触れるまま）

## 目的

**人間の指示（2026-10-05）。** `https://nisoine.com/` の「さわってみる」のスマホ（056 の枠の絵 + iframe）を **3D のモデル**で表示し、**画面のふちをドラッグすると傾く**ようにする。**枠の中のデモ（`/app/?demo=1`）は今まで通り触れること。**

## 0. 決めたこと（A）

**A が試作で確かめた（2026-10-05。`artifacts/068/prototype.html`・`prototype-tilted.jpg`。Chromium）**: WebGL は触れる iframe を絵として貼れないが、**WebGL の本体と本物の iframe を同じカメラで重ねる**（three.js の `WebGLRenderer` + `CSS3DRenderer`）と、傾けた状態でも iframe の中のボタン・スクロールが効く（傾き 0.25・-0.55 rad でクリックとスクロールが iframe に届いた）。ふちのドラッグで傾き、離すと正面に戻る。

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | 描き方 | **2 層を同じカメラで描く**: 下に `CSS3DRenderer`（**既存の iframe をそのまま** `CSS3DObject` に入れる。2 つ目の iframe は作らない）、上に `WebGLRenderer`（`alpha: true`・`pointer-events: none`）で本体。画面の位置に**穴**（`PlaneGeometry` 390×844・`opacity: 0`・`blending: NoBlending`）を置き、下の iframe が見えるようにする | 試作の形。iframe は本物の DOM なので触れる。WebGL の層は入力を受けない |
| 2 | モデル | **コードで組む**（`RoundedBoxGeometry` の本体・側面のボタン 3 つ・画面の上のピル型の黒い島・背面のカメラの出っ張り）。**外部の 3D モデル（glTF）は使わない** | ライセンスと Apple の意匠の心配が無い。読み込むファイルが増えない。形は「スマホらしい」で足りる |
| 3 | 色と光 | 本体はダークのチタン調（`MeshStandardMaterial`・`metalness` 0.6 前後・`roughness` 0.35 前後）。環境光 + 斜め上の平行光 1 つ。**値は B が 1280 幅で見て決め、報告に書く** | LP の淡いピンクの地に浮く |
| 4 | ドラッグ | ステージ（スマホの周り）で `pointerdown` → `pointermove` で傾ける。**画面（iframe）の上の操作は iframe が受ける**ので、ドラッグはふち・ステージの余白からだけ始まる。傾きは `rotateX` ±0.5 rad・`rotateY` ±0.7 rad で止める。離すと **約 0.6 秒で正面に戻る**（減衰）。カーソルは `grab` / `grabbing` | 人間の言う「ふちをドラッグ」。画面の中は今まで通りデモの操作 |
| 5 | 描画のループ | **見えている間（`IntersectionObserver`）かつ動いている間だけ** `requestAnimationFrame`。止まっている間は描かない | 電池と CPU。LP の他の節をスクロールしている間は 0 |
| 6 | 出す条件（そうでなければ今の 2D のまま） | **幅 768px 以上**（056 のとおり節ごと出ている）**かつ WebGL が使える かつ `prefers-reduced-motion: reduce` でない**。条件を満たさないときは、今の枠の絵 + iframe（056）をそのまま使う。**HTML は今の 2D の形のまま書き、JS が条件を見て 3D に組み替える**（JS が読めなくても今と同じ表示） | 段階的に足す。今の表示を壊さない |
| 7 | JS の置き方 | **自分のオリジンの外部ファイル 1 つ**（`/phone3d.js`。`<script type="module" src="/phone3d.js">`）。**three.js は CDN から読まない**（CSP の `script-src 'self'` のまま）。`three` を依存に足し、`build-public.mjs` が esbuild で 1 ファイルに束ねて圧縮する（`three` の使う部分だけ）。**inline script・importmap は置かない**。**gzip で 200KB 以下** | CSP を緩めない。ハッシュも要らない |
| 8 | 読み込みの時機 | `phone3d.js` は節が見える少し前（`IntersectionObserver` の `rootMargin` 400px）に `import()` で読む。最初の表示（ヒーロー）を遅らせない | 015・056 の「初回表示の速さ」 |
| 9 | 054 の 0節 #13「JS を入れない」 | **改める**: 「inline script は置かない。外部の JS は `/phone3d.js` の 1 つだけ（「さわってみる」の 3D。無くても表示は成り立つ）」。A が 054 を直した | 決まりを黙って破らない |
| 10 | 枠の絵 `phone-frame.png` | **残す**（#6 の 2D のとき使う） | 段階的に足す |
| 11 | スマホ幅 | 今まで通り節ごと隠す（056） | |
| 12 | `releases.ts` | 載せない（LP で、アプリの機能ではない） | |

## 1. B の作業

- `three` を依存に足す（置き場所は B が決めて報告に。LP の JS の元は `apps/landing/js/phone3d.mjs` など）。`build-public.mjs` に束ねる段を足す（060 のコメント除去と同じ場所）。`apps/api/public/phone3d.js` が出る
- `apps/landing/index.html`: 節「さわってみる」の末尾に `<script type="module" src="/phone3d.js"></script>` を 1 行（または #8 の読み込みの仕掛けを `phone3d.js` 側に）。今の HTML の形は変えない
- `apps/landing/style.css`: 3D のときのステージの大きさ・カーソル
- `phone3d.mjs`: 0節 #1〜#8。**傾きの計算（ドラッグ量 → 角度・上下限・減衰）は純粋な関数に分けて export**（テストのため）
- 画面: `artifacts/068/`（1280 幅の正面・傾けたところ・傾けたままデモのタブを押したところ。767 幅で節が出ない。`prefers-reduced-motion` で 2D のまま）

## 2. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | `/` の HTML に inline script が無い（`<script` は `src="/phone3d.js"` の 1 つだけ）。`<iframe` は 1 つのまま（056 T5） | `apps/api/test/landing.test.ts` |
| T2 | 傾きの関数: ドラッグ量から角度・上下限で止まる・減衰で 0 に近づく | 単体テスト |
| T3 | `build-public` の出力に `phone3d.js` があり、gzip で 200KB 以下。`https://cdn` 等の外部の URL を含まない | `apps/api/test/build-public.test.ts` |
| T4 | 実ブラウザ（Playwright・Chromium）で: 3D になる（canvas がある）→ ふちをドラッグすると傾く → **傾けたまま iframe の中のタブを押すとデモの画面が変わる** → 離すと正面に戻る。`prefers-reduced-motion: reduce` では canvas が無く 2D の枠 | `artifacts/068/scripts/` と報告（056 の撮影と同じ扱い） |
| T5 | CSP の応答ヘッダが今と同じ（053 T4b・056 T1 が緑のまま） | 既存 |

## 完了条件

- T1〜T5。`pnpm -r test`・型チェック・lint
- 画面 `artifacts/068/`
- 本番デプロイ後、人間が PC の Chrome で触る（**Safari（Mac）は持っていれば**。`CSS3DRenderer` と iframe の組み合わせは Safari で描き方がずれることがある。ずれたら A へ）
- `state.md` / `worklog.md`

## 停止条件

- Safari で iframe の位置が本体の穴とずれる・iframe がぼやけて読めない → 画面を撮って A へ（Safari だけ 2D にする分岐を A が決める）
- `phone3d.js` が gzip 200KB を超える → A へ
- 傾けると iframe の中の操作が効かない（試作と違う）→ A へ
- レビュー往復 3 回 → A へ

## 順序

すぐ。iOS 段階0・メール認証の前。
