## 068 #465（8864853）— R の判定

**受け入れ。必須修正なし。**（CI 緑を確かめた）

R の手元（futary-R、`pnpm install --frozen-lockfile` から。インストール後に作業ツリーの差分なし）で確かめた:

- **T1〜T3・T5**: type-check・lint 緑。`pnpm run test` は ui 23・date 68・db 34・app 630・api 796 = 1,551 で全部緑。audit の high は無視リストだけ
- **束ね（0節 #7）**: `node scripts/build-public.mjs` で `phone3d.js` 569,522 バイト。R が `gzip -c` で測って 144,964 バイト（ビルドの表示は 145,967。どちらも上限 204,800 の下）。three.js の `@license` の注記は残っている。`apps/landing/js/*.mjs` の元は public に写らない（`build-public.mjs` はファイルを名指しで写す）
- **配信**: wrangler dev で `/phone3d.js` は 200・`text/javascript`・`Cache-Control: public, max-age=0, must-revalidate`（名前にハッシュは無いが、毎回確かめ直すので古いものが残らない）。`/` の CSP は `script-src 'self'` のまま
- **T4**: `seed:local` でデモのペアを入れてから `artifacts/068/scripts/capture.mjs` を R の手元で流して **7 / 7 OK**（矩形の値も報告と同じ: 正面 316×684・傾き 289×707、`/app/` → `/app/calendar`）
- **R が足した確かめ**（Playwright・Chromium。スクリプトは R の scratchpad の `extra.mjs`）:
  - マウスだけで、余白で押して右へ引くと傾く（260×712）。`is-dragging` が付く。**iframe の上で離しても** 1.2 秒後に正面（316×684）に戻り、`is-dragging` も外れる（pointer capture が効いている）
  - 画面（iframe）の上で押して引いても傾かない（316×684 のまま）
  - **傾けたまま iframe の上でホイールを回すと、デモの中がスクロールする**（0 → 247）。傾きはそのまま
  - 止まっている間・戻り終わった後は `requestAnimationFrame` が 0 回（1〜1.5 秒数えた）
  - ページの例外は 0
- 傾けた最大の角度（x 0.5・y 0.7 rad）でも、本体はステージ（527×791）の中に収まる（R が透視で見積もって、上下は中心から 364px 前後で半分の 395px の内側。画面でも切れていない）
- 0節 #8 の `import()` を使わず 2 段にしたのは、0節 #7「外部の JS は 1 ファイル」と両立させるためで、理由は通る（定義の文言との差は下の記録 3）
- `worklog.md` は追記のみ（削除 0 行）。コミットのトレーラーは `Session: B` と Co-Authored-By が続いている

## 記録（判定に使わない）

1. **3D のとき、デモの iframe の HTML（`/app/?demo=1`）が 2 回読まれる。**R が数えた（1280×900、Chromium）: 3D では約 20ms 差で 2 回（スクロールの有無・`#demo` で開くのどれでも）、2D（reduced-motion）では 1 回。JS の束（`entry-*.js`）は 3D でも 1 回だけ。Chromium の lazy の読み込みはビューポートからかなり離れた位置で始まるので、モジュールが iframe を移すより先に 1 回目が始まり、移したところで読み直している。報告の「lazy の読み込みが始まる前に移す」はこの計測と合わない。無駄になるのは小さな HTML の 1 回分で、画面には出ない
2. `.phone.is-3d` の `touch-action: none` のため、**幅 768px 以上のタッチの端末（iPad 等）では、スマホの左右の余白（各 90px 前後）から始めたスワイプでページがスクロールしない**（傾ける操作になる）。0節 #4 のとおりの動きだが、人間が iPad で触るときに見てほしい
3. 0節 #8 は今も「`import()` で読む」と書いてある。実装は 2 段（すぐ CSS3D の層・400px 手前で WebGL）。定義を実装に合わせるかは A の判断
4. R の手元では最初、デモが「デモを読み込めませんでした」になった（`/api/couple/get` が 403）。R のローカルの D1 にデモのペアが無かっただけで、`pnpm --filter @futary/db run seed:local` の後は通った。068 とは関係ない（2D でも同じだった）

## 私が確かめていないこと

- Safari（Mac・iPad）・Firefox。停止条件の「Safari で iframe と穴がずれる・ぼやける」は人間の手番
- 実機のタッチ（CDP のタッチで代えた）
- GPU の無い環境・WebGL が途中で失われたとき（`webglcontextlost`）の振る舞い

---

## 追補 #469（589fc21。人間のモデル・傾き約 80°・タッチ・縞）— R の判定

**受け入れ。必須修正なし。ただし、マージの前に main の取り込みが要る。**

- **#469 は今 main とぶつかっていて（`mergeable: CONFLICTING`）、CI が 1 回も走っていない**（PR の checks は空）。ぶつかっているのは `docs/state.md` だけ（`git merge-tree` で確かめた。#468 が同じ先頭を書き換えた）。main を取り込んで、**CI が緑になってからマージすること**

R の手元（futary-R、`pnpm install --frozen-lockfile` から。インストール後に作業ツリーの差分なし）で確かめた:

- **テスト**: type-check・lint 緑。`pnpm run test` は ui 23・date 68・db 34・app 630・api 799 = 1,554 で全部緑
- **大きさ**: `phone3d.js` は gzip 166,219 バイト（ビルドの表示。R の `gzip -c` では 165,203）で上限 200KB の下。`phone.glb` は 585,632 バイト・R の `gzip -c` で 368,935 バイトで上限 500KB の下
- **GLB の中身**（R が GLB を解いて見た）: メッシュ 1・材質 1・画像 1（1024×1024 の JPEG・131,872 バイト・EXIF 無し）・三角形 14,015。拡張は `KHR_mesh_quantization` だけ（Draco・meshopt は無い）。外部の URI は無い（バッファも画像も GLB の中）
- **ロゴ**: **配信する GLB から取り出したテクスチャそのもの**を R が目で見た。背面（左から 2 列目）にロゴは無い。コントラストを強めると、塗った箱の範囲がうっすら四角く見えるが、ロゴの形は見えない。元の zip のテクスチャには、報告の箱の位置に Apple のロゴがあることも確かめた（塗る場所は合っている）。元のテクスチャを 1024px で見た範囲で、ほかに他社の文字・印は見当たらない
- **配信**: wrangler dev で `/assets/phone.glb` は 200・`model/gltf-binary`・`Cache-Control: public, max-age=0, must-revalidate`。CSP は `connect-src 'self' blob: …`（GLB の fetch）・`img-src 'self' data: blob: …`（テクスチャの blob:）で通る。CSP は変わっていない
- **T4**: `seed:local` の後、`capture.mjs` を R の手元で流して **9 / 9 OK**（正面 312×700・傾き 269×748・80° で 54×798・タッチの縦スワイプでページが 938 → 1123 にスクロールして傾かない）
- **R が足した確かめ**（Playwright・Chromium。スクリプトは R の scratchpad の `extra.mjs`・`fallback.mjs`）:
  - #465 のときと同じ 5 つ（マウスだけで傾く・iframe の上で離しても戻る・画面の上から引いても傾かない・傾けたままホイールでデモの中がスクロール 0 → 216・止まっている間の rAF は 0 回）がこの版でも通る。ページの例外は 0
  - **`/assets/phone.glb` を 404 にすると 2D に戻る**: `.is-3d`・canvas・CSS3D の層が消え、iframe は `.phone` の直下で枠の絵の前に戻り、`style` 属性も無くなる。枠の絵が見える。その後デモの「カレンダー」を押すと `/app/calendar` に変わる。余白をドラッグしても何も起きない
- **縞**: `near`・`far` をモデルのまわりに詰めた理由は通る。R の見積もりでは、モデルの点は画面の中心から最大でおよそ 0.56 × K（約 509 単位）で、`near`・`far` の幅 ±0.6K（約 544）の内側に収まるので、どの傾きでも切れない。`angles-1280.png` と R の撮った 80° の画面に縞は無い
- 画面の縁と iframe: 正面の画面で、iframe の角は黒い縁の内側に収まっていて、はみ出しや隙間は見えない
- `tiltFromDrag` の `yOnly`、`touch-action: pan-y`（縦のスワイプで `pointercancel` が来て離したことになる）は 0節 #4 のとおり
- `worklog.md` は追記のみ（削除 0 行）。コミットのトレーラーは `Session: B` と Co-Authored-By が続いている

## 記録（判定に使わない）

1. **GLB を読んでいる間は、本体の無い画面（角丸の iframe だけ）が見える。**R が GLB を 3 秒遅らせて撮った: `.is-3d` で枠の絵は隠れ、canvas はまだ無い。読み終わると本体が出る。読み込みは節の 400px 手前で始まるので、速い回線ではほぼ見えないが、遅い回線ではしばらくこの形になる。直すなら、本体が出るまで 2D の枠の絵を残すなどだが、A の判断
2. **公開リポジトリ（GitHub の visibility は PUBLIC）の `docs/sample/fbx/purple smartphone 3d model.zip` には、Apple のロゴが入ったままの元のテクスチャがある。**配信するものからは消えているが、リポジトリからは取り出せる。追跡に入れたのは定義どおりで、README にも「使うときは塗りつぶす」と書いてある。気にするかは A・人間の判断
3. 0節 #3（色と光: ダークのチタン・`metalness` 0.6 前後）は、モデルのテクスチャ（紫）に置き換わった。値（`metalness` 0.35・`roughness` 0.45・光 1.4・2.4）は報告にある。定義の #3 の文言を今に合わせるかは A の判断
4. 画面の上の島は、#465 のときと同じく、デモの帯「これはデモです…」の文字に重なる（2D の枠の絵の切り欠きも同じ）

## 私が確かめていないこと

- Safari（Mac・iPad）・Firefox・実機のタッチ
- 遅い回線での実際の見え方（Playwright で GLB を遅らせただけ）
- main を取り込んだ後の CI（まだ走っていない）
