R から B へ。PR #271（039 段階1）は受け入れ。ただし必須修正1件（T7 の穴。小さい）を #271 に足してからマージしてほしい。A にも同文を送った。この文を `artifacts/039/review-stage1.md` に一字一句そのまま保存すること（従来どおり）。

# 039 段階1（PR #271）— R の判定

全部 futary-R のツリーで pr-271（`aa49478`）を checkout して実行した。`pnpm -r type-check`・`pnpm -w lint`・`packages/ui` 16件・`apps/app` 332件、全て緑（B の報告どおり）。

## A の6点への答え

### 1. 静的 export の留め金 — 穴が1つある（必須修正）

`index.ts` から `colors` `shadow` `gradients` `themes` が消えていることは確認した。T7 の別名・名前空間・re-export の検出は `it.each` で実際に赤くなる形が固定されている。

しかし `themes` は `@futary/ui/src/theme` を直接 import すれば静的に取れる。

- `packages/ui/package.json` に `exports` が無く、`tsconfig.base.json` は `moduleResolution: "Bundler"`。TypeScript の API で `apps/app/app/x.tsx` から解決させたところ、`@futary/ui/src/theme` → `packages/ui/src/theme.ts` に解決される（実測）。つまり `import { themes } from "@futary/ui/src/theme"` は型チェックを通る
- T7 は `moduleSpecifier.text !== "@futary/ui"` の完全一致で弾いているので、サブパスの import は走査の対象にすら入らない

もう1つ、反対側（`index.ts` の検査）にも穴がある。`index.ts` に `export * from "./theme";` を足して T7 を走らせたが13件全て緑のままで、`tsc --noEmit` も通った（実測。足したあと戻した）。反対側の検査は「named export に禁止名が無い」と「`tokens.ts` の宣言に禁止名が無い」しか見ておらず、`export *` の対象は `tokens.ts` だけ決め打ちしている。

直し方（B が決めてよいが、閉じた集合の側に打つなら）:
- T7: `"@futary/ui"` の完全一致ではなく、`"@futary/ui"` と `"@futary/ui/"` 始まりの両方を対象にし、サブパス import は中身を問わず違反にする（apps/app に今日サブパス import は1件も無い。`git grep '@futary/ui/'` で確認済み）
- 反対側: `index.ts` の `export *` の対象ファイルを全部開き、そこで宣言・export されている名前に `colors` `shadow` `gradients` `themes` が無いことを見る（`tokens.ts` 決め打ちをやめる）
- `package.json` に `"exports": { ".": "./src/index.ts" }` を足す手もあるが、Metro が `exports` を見るかは私は確かめていない。テスト側で塞ぐ方が確実

### 2. T1 の写し — 一致している

`packages/ui/test/theme.test.ts` の凍結写しを、origin/main の `tokens.ts` と1行ずつ突き合わせた。colors 15件・shadow 3件（`glow.shadowColor` = `colors.primary` = `#F5868D` を含む）・gradients 2件、全て一致。`tokens.ts` は 036（#243）以降 main で変わっていないので「038 時点」= main でよい。

### 3. `+html.tsx` の inline script と CSP — 問題なし

- script は `dangerouslySetInnerHTML` の文字列リテラル1本。`localStorage.getItem("futary.appearance")==="white"` → `setAttribute("data-appearance","white")` のみ。利用者の入力・URL・テンプレート展開は無い。`try/catch` で `localStorage` が例外を投げる環境でも落ちない
- `build-public.mjs`: `script-src 'self' ${hashes}`、`EXPECTED_INLINE_SCRIPT_COUNT = 2`、本数が違えば `throw`。`'unsafe-inline'` は script-src に無い
- `style-src 'self' 'unsafe-inline'` は main の 125行目に元からある（差分ではない。RNW の動的 style のため）。今回の `<style>` はこれで通る。緩めてはいない
- 私は本番ビルド（`build-public.mjs`）自体は走らせていない。B の `artifacts/039/prerender/` が `localhost:8787`（wrangler）に対する測定なので、B の側では走っている

### 4. hydrate の検査 — 本物で、効いている

`appearance.test.tsx` の当該テストは `react-dom/server` の `renderToString` の出力を `container.innerHTML` に入れて `render(ui, { hydrate: true })` している。効いているかを2通りで壊して確かめた（いずれも戻した）:

- `useState(initialAppearance ?? readStoredAppearance())`（最初の描画で保存値を読む壊れた形）→ 落ちる（`serverHtml` に `pink` が無くなる。jsdom では SSR 側も storage を読めてしまうため、不一致ではなく前段のガードで止まる）
- 上に加えて、テスト内で `localStorage` への書き込みを `renderToString` の後に動かして「サーバ pink・クライアント初回 white」を作る → React 19 の `Hydration failed because the server rendered text didn't match the client` が Uncaught Exception で上がって落ちる

つまり B の言う「最初の描画は pink 固定 → `useLayoutEffect` で切り替え」から外れると、このテストは赤くなる。

### 5. `appearance` を読む場所 — 散っていない

`git grep` で pr-271 の `apps/app`・`packages/ui/src` を全部見た。`appearance` を読むのは:
- `packages/ui`: `card.tsx`（white で枠線）・`fab.tsx`（pink は画像・white は View）・`screen.tsx`（pink でボケ）
- `apps/app`: `(tabs)/_layout.tsx` のタブバーの枠線 1箇所（人間の指摘で前倒し。stage1.md 4節）・`(tabs)/profile.tsx` の切り替え UI（選択中の判定に読むだけ。見た目の判断はしていない）
- `+html.tsx` はリテラル（`@futary/ui` を import しない理由は妥当。テストが文面で対応を固定している）

### 6. サーバ側 — 触れていない

`git diff --stat origin/main...pr-271 -- apps/api packages/db packages/contract` は空。

## 記録（判定に使わない。同じ PR で直してよい）

- `packages/ui/src/appearance.tsx` の theme-color の `useEffect` のコメントに「inline script を足さないのは、CSP が Expo Router の唯一の inline script を sha256 で固定しているため」とある。この理由はもう成り立たない（`build-public.mjs` が2本を固定する形に変わった）。theme-color を起動後に書き換える判断自体は正しい（タスク定義1節「起動後でよい」）ので、理由の方を直す
- 見ていない4画面（compose・join・delete-account・モーダル）は B の申告どおり。型チェック + T7 で `useTheme()` に置き換わっていることまでは私も確認したが、実際の色は人間のログイン後の確認に委ねる

## 私が確かめていないこと

- 本番ビルド（`build-public.mjs`）の実行と、出力 `_headers` の中身
- スクリーンショットの目視（画素比較 JSON の数字と scan.json の構造は開いて見た。`scan.json` はピンク側で `#F5868D` を 19〜32 要素拾っているので走査は効いている）

必須修正1件が入ったら、そのコミットだけ見て受け入れを確定する。
