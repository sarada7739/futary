# 063 段階1 — R の判定

futary-R で origin/task/063-stage1（4a32b7d）を checkout。`worklog.md` は追記のみ（削除 0 行）。

**受け入れ。必須修正なし。**

## T2（コメント以外の変更が無い）: B とは別の方法で確かめた

B の `compare-code.mjs`（プリンタで出し直して比べる）に頼らず、R は**構文木の葉（識別子・リテラル・キーワード・記号。JSDoc は除く）の列**を前後で比べる道具を別に書いた（scratchpad。コミットしない）。
- 15582d8（コメント）: 57 ファイル全部で葉の列が一致。コードの変更は 0
- 12045bb（デッドコード）: 違うのは `plan.ts`（`unlockedPhotoIds` の 1 関数）・`db/src/index.ts`（`type Db` の 1 行）・`theme.ts`（`filterId`・`lens*` 3 つ）・`+html.tsx`・テスト 2 本だけ。`glass-tab-bar.tsx` はコメントだけ
- `@ts-expect-error`・`eslint-disable`・`/// <reference>`・`#__PURE__` 等の動作に効くコメントの数は、57 ファイルとも前後で変わらない

## 0節 #10・#11（消したコード）

`unlockedPhotoIds`・`filterId`・`lensBlurRadius`・`lensBrightness`・`lensSaturate`・`tab-album`・`nisoine-glass`・`GLASS_FILTER` を `apps`・`packages`・`scripts` で R も数え直して 0 件。`type Db` を import しているところも無い。`panelPhotoToday` は残っている（#11 のとおり）。

## 0節 #1（残すべき理由）: セキュリティ・認可の語を含むコメントを前後で読み比べた

`auth.ts`（secret の fail-fast・http はホスト名で判定・cf-connecting-ip）・`auth-context.ts`（fail-closed・`is_demo` を DB で確かめる理由）・`security-headers.ts`（CSP のハッシュを配信 HTML から計算する理由・R2 の単一ホスト）・`index.ts`（GET を拒む・オープンリダイレクト・Webhook を CORS の前に・AI の鍵を片方だけ積む）・`r2-signed-url.ts`（キーを入力として受け取らない・contentType を署名できない）・`reaction.ts`（EXISTS で 1 文）・`billing.ts`（他ペアの customer を引けない）・`me.ts`（削除を 1 batch にする理由・R2 を先に消す理由と代償）・`schema/couple.ts`（レート制限のキーを Google の sub にする理由）。**理由はすべて短くなって残っている。**消えたのは指摘者（security-auditor・R）・何回目か・経緯で、0節 #2 のとおり。

## テスト

減ったのは 0節 #10 で消したコードの検査 2 本だけ（`removed-tests.md`）。0節 #6（必ず残す）に当たるものは無い（T4）。

## 記録（判定に使わない）

1. `me.ts` の退会の削除順は、番号つきの 13 段の一覧から「並びは FK の向き（参照する側を先に）。表を足したら手順にも足す（architecture.md 4節）」に縮んだ。順序そのものはコードが正で、一覧はコードの言い換え（#2）なので妥当。各表の「ON DELETE no action なので couples より先に」の注記も同じ要約に入っている
2. export を外すだけの約 110 件を触らなかった判断は妥当（コードの差分を増やさない）。要るかどうかは A

## 私が確かめていないこと

- `pnpm -r test` の全件（B の 1,541 → 1,539 と CI に頼る。R は差分と葉の列の一致を見た）
