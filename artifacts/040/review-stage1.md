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


---

# 040 段階1（PR #289）— R の追記（5bbcc35 を見て）

R から B へ。5bbcc35 を見た。必須修正 2 件は直っている（私の再現 2 本を 5bbcc35 で走らせ直した: `content="Levi's 501 ジーンズ"` → `Levi's 501 ジーンズ`、`amzn.example` → 301 → `www.amazon.co.jp` で画像あり・題名「テスト商品」）。`Object.hasOwn` も確認。link-preview 90・want 34・authorization・me の削除テスト、型・lint 緑（私の環境の既知の 3 件を除く）。

**ただし、A から別途「6節の条件を 1 つずつ壊して対応するテストが赤くなるか」を当てるよう依頼があり、実際に 13 通り壊した。11 通りは赤になった。赤にならなかったのが 2 つ。うち 1 つを必須（テスト追加のみ）にする。**この文も `artifacts/040/review-stage1.md` に追記すること。

## 壊して赤になった（11）
`.internal` を外す（2 件赤）／`.local` を外す（2）／リダイレクト先の再検査を外す（1）／`MAX_REDIRECTS` を 4 に（2）／先頭バイトの検査を外す（1）／画像 1MB を 2MB に（1。want.test の T3）／ページ 1MB を 2MB に（1）／12 秒を 60 秒に（1）／Cookie ヘッダを足す（1）／scheme の検査を外す（2）／Amazon 判定を全ホストに（1。A の 6 点目「他店の HTML に `data-old-hires`」は B のフィクスチャで既に捕まっている）

## 赤にならなかった（2）

### 必須（テスト追加）: 画像の fetch が 12 秒の期限を共有していることを、どのテストも捕まえていない
`fetchImage(fetchImpl, resolved, controller.signal, failures)` の `controller.signal` を `new AbortController().signal`（共有しない別物）に変えても、**link-preview 90 件・want 34 件が全部緑**（5bbcc35 で再確認）。コードは正しいが留め金が無い。ページが 1 秒で返り、画像サーバが返さない（drip）ケースで、12 秒を超えて待ち続けても誰も気づかない。
テストの形: ページは即 200（`og:image` あり）、画像の `fetchImpl` は `signal` の abort まで resolve しない Promise を返す（`signal.addEventListener("abort", () => reject(new DOMException("…", "AbortError")))`）。fake timers で 12 秒進めて、`image` が null・`failures` に「12000ms で打ち切った」が入ることを見る。既存の「上限は 12 秒」のテストがページ側で同じ形をしているなら、それを画像側にも 1 本。

### 記録（判定に使わない）: Content-Type の許可リストを外しても緑
`if (!(declared in ALLOWED_IMAGE_TYPES))` を素通しにしても全部緑。理由は、その後の `sniffed !== declared` が「先頭バイトが jpeg/png/webp のどれかで、かつ宣言と一致」を要求するので、許可リストは冗長になっているから。穴ではない（sniff 側で閉じている）。テストを足す必要は無いが、コメントに「先頭バイトの一致だけで十分。許可リストは失敗理由を分けるため」と書いておくと次の人が「テストが無い」と慌てない。

## A の残りの点（私の答え）
- fetch が外へ出る場所: `apps/api/src` で `fetch(` は `link-preview.ts` と既存 `ai.ts` だけ（前の判定で確認済み）
- `owner_id` は `toWant` の戻り値に無い。`Want.url` の出力は `isHttpUrl` で `javascript:` を落とす（T11、DB 直挿しのテストあり）
- `me.delete`: `wants` は batch 内で `invites`・`couple_members`・`couples` の前。`user` 行は消さない（Candle 型）ので `owner_id` の FK にも当たらない。T7 緑
- ホームの 3 列化: `index.tsx` は `PANEL_COLUMNS = 3` とコメントと `FeaturePanel` 1 枚の追加だけ。`feature-panel.tsx` は無変更

期限共有のテスト 1 本が積まれたら、そこだけ見て確定する。


---

# 040 段階1（PR #289）— R の確定（head 0f9d7ab）

R から B へ。PR #289 の head 0f9d7ab を見た。**040 段階1、受け入れ確定。マージしてよい。**A にも送る。この文を `artifacts/040/review-stage1.md` に追記すること。

確かめたこと（futary-R で 0f9d7ab を checkout。触ったものは戻した）:
- **期限共有のテスト（0f9d7ab）**: `fetchImage` に渡す signal を `new AbortController().signal` に変えると「画像の fetch もページと同じ 12 秒の期限を共有する」が赤（5 秒でタイムアウト）、戻すと緑。私の環境でも同じ。留め金は閉じた
- **最終 URL の正規化（cf48d5d）**: `fetchLinkPreview` が `finalUrl` を返すのは `fetchFollowingRedirects` が全ホップで `isFetchableUrl` を通したときだけ（弾かれれば `null` → 元の URL のまま）。`want.create` は `canonicalAmazonUrl(finalUrl)` が Amazon の `/dp/{ASIN}` を返したときだけ差し替える。fetch に行かない経路（画像も題名も手で付けた）と `update` は `normalizeWantUrl(input.url)` のまま。私が確定時に見ると言った 2 点はどちらも満たしている。ログの Content-Type は 100 文字で切る（記録 3 の対応）
- link-preview 58・want 37・authorization・me（削除 5 件）緑（既知の環境起因 3 件を除く）。app 364 緑。型チェック・lint 緑

残るのは人間の手番（本番で Amazon の URL、できれば `amzn.asia/d/…` の共有リンクも 1 本貼って画像と `/dp/` の正規形を確かめる）。
