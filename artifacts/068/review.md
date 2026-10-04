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
