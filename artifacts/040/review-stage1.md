# 040 段階1（PR #289）— R の判定

futary-R で 0f07fb8 を checkout して実行した。触ったものは全て戻した。

## 守りたいことの一文（A）— 成り立っている

- **fetch は 1 本**: `apps/api/src` で `fetch(` を呼ぶのは `link-preview.ts` と既存の `ai.ts` だけ。`fetchLinkPreview` の呼び出し元は `want.ts` の `want.create` 1 箇所（`url` があり、画像か題名が無いとき）
- **scheme**: 契約 `urlInputSchema`（`isHttpUrl`）+ `isFetchableUrl`（二重）。出力も `urlOutputSchema` で `javascript:` を落とす（`want.test.ts` T11 が DB 直挿しで確認）
- **ホスト**: `isFetchableHost`。私が URL パーサの正規化を実測した: `0x7f000001`・`2130706433`・`0177.0.0.1`・`127.1`・`example.com@127.0.0.1` は全部 hostname `127.0.0.1` になって弾かれる。`[::ffff:127.0.0.1]` は `[` で弾かれる。`localhost.`・`LOCALHOST`・`.local`・`.internal` も弾かれる。リダイレクト先も同じ関数を通る（`fetchFollowingRedirects` のループ先頭）
- **リダイレクト 3 回**: `redirect: "manual"` で自分で辿り、4 回目で止める
- **1MB・12 秒**: `readUpTo(PAGE_BYTE_LIMIT)`、`AbortController` 1 つをページと画像で共有、`finally` で `clearTimeout`
- **画像の型と 1MB**: `Content-Type` の許可リスト + `sniffImageType`（先頭バイト）の**両方一致**を要求。超過は `truncated` で拒む
- **Cookie 無し・UA**: ヘッダは `user-agent`・`accept`・`accept-language` の 3 つだけ
- **拾う属性の列挙**: `og:title`・`og:image`・`twitter:image`・`<meta name="title">`、Amazon に限り `data-old-hires` → `data-a-dynamic-image` の先頭。6節の列挙と一致。DOM も script も無い
- **失敗しても保存は成功**: `fetchLinkPreview` は例外を投げない。`want.create` は `console.warn` に `failures` を 1 行（URL・キー無し）。R2 の put が失敗しても画像無しで保存
- **本人だけ・couple_id の外に触れない**: update / setImage / setObtained / delete は `WHERE id AND couple_id AND owner_id AND deleted_at IS NULL` の 1 文で、0 件は全部 `NOT_FOUND`。list の partner 解決は `couple_members` を `couple_id` で絞る。ゲストは slot 1/2。画像の鍵は `wantImageKeyFor(coupleId, …)` でサーバが組み立て、`imageId` は `IMAGE_ID_PATTERN` で縛られる
- **me.delete**: `wants` の行（batch 内）と `couples/{id}/wants/` の接頭辞削除。`me.test.ts` の削除テスト 5 件は私の環境でも緑

## 必須修正（2 件。`link-preview.ts`）

### 1. `content` 属性の中のアポストロフィで題名が切れる

`pickMeta` の正規表現は `content=["']([^"'<>]*)["']` で、**値の中の `'` を閉じ引用符と見なす**。実測: `<meta property="og:title" content="Levi's 501 ジーンズ">` → 題名 **`Levi`**。`Levi's`・`Kids'`・`Children's` は商品名に普通にあり、`&#39;` に実体化していない店も多い。画像 URL でも `'` は稀だが同じ穴。

直し方: 引用符の種類ごとに閉じる（`"([^"<>]*)"|'([^'<>]*)'` の 2 択）。`pickAmazonImage` の 2 本も同じ形なので揃える。T2 に `content="Levi's …"` の 1 本を足す。

### 2. Amazon 用の規則が「元 URL のホスト」で決まり、リダイレクト先を見ていない

`fetchLinkPreview` は `pageHostname = new URL(url).hostname` を `extractMeta`・`normalizeTitle` に渡している。**実際に読んだページのホスト（`finalUrl`）ではない。**実測（fetch を差し替え）: `https://amzn.example/short` → 301 → `https://www.amazon.co.jp/dp/…` の HTML は、**画像「属性が無い」・題名は `Amazon | テスト商品 | 通販` のまま**。同じ HTML を `www.amazon.co.jp` で直接読むと画像あり・題名「テスト商品」。

Amazon アプリの共有は `https://amzn.asia/d/…` の短縮 URL を出すので、人間の主な使い方で画像が付かない。A の決定「Amazon のホストのときだけ動かす」は**読んだページのホスト**で判定する方が条文どおり（効く範囲は狭いまま）。直し方: `extractMeta` と `normalizeTitle` に `new URL(finalUrl).hostname` を渡す。テストはリダイレクト経由 1 本。**A が「元 URL のホストで判定する」と決めるなら撤回する**が、その場合は `amzn.asia` に画像が付かないことを人間に伝えること。

## T1〜T11 — 全部緑（私の環境）

`want.test.ts`・`link-preview.test.ts`・`authorization.test.ts` 157 件、`want-screen.test.tsx` を含む app 364 件、db 30・date 61・ui 16。型チェック・lint 緑。**T9 は私も viewerKey を外して赤（`want.tsx:304 … viewerKeyが確認できません`）になることを確かめて戻した。**

## 記録（判定に使わない）

1. **DNS で内部へ向くホスト名は通る**（`127.0.0.1.nip.io` は `fetchable=true`。実測）。6節の条文がホスト名の字面で書かれているのでそのとおりで、二重目は Cloudflare 側。条文に「名前解決の先は見ない（Cloudflare 側が塞ぐ）」と 1 行あると、次に読む人が「忘れた」と思わない。A へ
2. `declared in ALLOWED_IMAGE_TYPES` は `in` なので `constructor`・`toString` 等のプロトタイプ名が第一関門を通る。先頭バイトとの一致で必ず落ちるので実害は無い。`Object.hasOwn` の方が意図が読める
3. `failures` に入る `declared`（Content-Type の media type）は長さを切っていない。本文は 200 文字で切っている。相手が長いヘッダを送れば長いログになるだけ
4. スクリーンショットは 0f07fb8 より前（`pink-want-me.png` に 🔗 が残っている）。差し替えは要らないが、報告と絵がずれていることは書いておく
5. 私の環境（futary-R、`.dev.vars` 無し）では `apps/api` の結合テスト 17 件が main と同じく落ちる。040 のテストはその中に無い

## 私が確かめていないこと

- 本番（Cloudflare の IP）からの Amazon 取得。段階0の 15/15 と人間の手番に依る
- 画面から「画像を付ける」の一連（ファイル選択）。B も Playwright ではしていない
- iPhone 実機

必須修正 2 件のコミットが積まれたら、そこだけ見て確定する。
