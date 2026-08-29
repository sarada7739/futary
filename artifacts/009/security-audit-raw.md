# 009: リアクション — security-auditor 生の出力

実行日: 2026-08-29 / セッションB
（M2 まとめ監査。006・008・009 を対象範囲としてまとめて実施した）

以下、監査エージェントの返答を一字一句そのまま記載する。

---

## [2026-08-29] 監査対象: M2 まとめ監査（006 投稿API / 008 タイムラインUI / 009 リアクション）

| 重大度 | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| **High** | `apps/api/src/index.ts:57-89`（+ 影響先: `apps/api/src/procedures/reaction.ts:15`, `post.ts:183,256`, `couple.ts` の書き込み系全て） | **oRPC の RPCHandler が HTTP メソッドを一切見ないため、全ての書き込み手続きが GET で実行できる。**実測根拠: `node_modules/.pnpm/@orpc+server@1.15.0_ws@8.21.3/node_modules/@orpc/server/dist/shared/server.CMf4nKky.mjs:182` が `async match(_method, pathname)` とメソッド引数を捨てており、同ファイル:120 の `decode` が `request.method === "GET"` のとき入力を `request.url.searchParams.getAll("data")` から読む。`index.ts:38` の Hono `app.use("/api/*", ...)` も全メソッドに掛かる。セッション Cookie は Better Auth 既定の `SameSite=Lax`（`auth.ts:97-102` は `useSecureCookies` のみ指定）で、**Lax はクロスサイトのトップレベル GET ナビゲーションに Cookie を載せる**。したがって `<a href="https://<host>/api/couple/update?data=...">` を踏ませるだけで、ログイン中の利用者のペアに対して `couple.update` / `invite.issue` / `post.create` / `reaction.toggle` が実行される。CORS は防げない（ナビゲーションは CORS の対象外で、CORS はレスポンスの読み取りを止めるだけ）。これは `security-requirements.md` 7節が CSRF 対策として明記している「`SameSite=Lax` + oRPC の POST 経由。**状態変更を GET で行わない**」という前提そのものが実装で成立していないことを意味する。判定根拠: 単一のリンククリックで成立し（容易さ大）、対象は 2人の私的タイムラインへの不正な書き込み・招待コードの無効化（004監査で Medium と判定された妨害と同じ効果）。ただし読み取りの越境やペア外への漏洩は起きない（書き込み専用の影響）ため、Critical ではなく High とした | `@orpc/server/plugins` の **`StrictGetMethodPlugin`** を `new RPCHandler(router, { plugins: [new StrictGetMethodPlugin()] })` として適用する。同プラグインは `dist/shared/server.TEVCLCFC.mjs:31` で「リクエストが GET かつ手続きの route.method が GET でない」なら `METHOD_NOT_SUPPORTED` を投げる。futary の手続きは全て既定（POST）なので、GET 経由の実行が一律で塞がれる。あるいは Hono 側で `app.use("/api/*", (c, next) => c.req.method === "POST" ? next() : c.notFound())` を oRPC ハンドラの前に置く。**回帰テストを1本追加すること**（`GET /api/reaction/toggle?data=...` が手続きを実行せずエラーになる）。現状の再現は `curl -b '<session cookie>' 'http://localhost:8787/api/reaction/toggle?data={"json":{"postId":"<自分の投稿ID>","kind":"heart"}}'` で確認できる（`data` の正確な形は `StandardRPCSerializer` の `{json, meta}` 形式。B が実測して証跡に残すこと） |
| Low | `apps/api/src/procedures/reaction.ts:49-57` ＋ `apps/api/src/procedures/couple.ts:33-35` | 例外を `isConstraintViolation`（`/constraint failed/i`）だけで判定して `reacted: true` を返している。この正規表現は `UNIQUE constraint failed` だけでなく `FOREIGN KEY constraint failed` / `NOT NULL constraint failed` にも一致する。つまり「他のリクエストが先に入れた」以外の失敗も**書き込みが起きていないのに成功として返る**。**認可の境界は破れていない**（INSERT の `WHERE EXISTS`（:44）が偽なら SQLite は行を作らず制約検査自体が走らないため、UNIQUE 違反は「対象投稿が自ペアにある」場合しか発生し得ない。他ペアIDは必ず `inserted === null` → NOT_FOUND になる。ご質問2の設計判断そのものは妥当と判断する）。現時点で FK 違反経路（`reactions.user_id` → `user.id`）はアカウント削除機能が無いため到達不能。将来の削除機能実装時に静かに壊れる形なので記録する | `reaction.toggle` 側の catch を `/UNIQUE constraint failed/i` に絞る。または catch 後に `SELECT 1 FROM reactions WHERE post_id=? AND user_id=? AND kind=?` で実在を確認してから `reacted: true` を返す |
| Low | `apps/api/src/procedures/post.ts:80`（`row.kind as ReactionSummary["kind"]`）＋ `packages/db/migrations/0005_reaction.sql:4` | `reactions.kind` に宣言的制約（CHECK）が無く、集計結果を無検証でキャストしている。契約側は `z.enum(REACTION_KINDS)`（`packages/contract/src/post.ts:11`）で、oRPC は出力スキーマがあれば実行時に出力を検証する。`REACTION_KINDS` に無い `kind` の行が1つでも入ると（014 のデモデータ投入、将来の種別削除、手動 SQL）、**その投稿だけでなく `post.list` 全体が 500 になりタイムラインが読めなくなる**。`architecture.md` 4節の「起きてはいけない状態は宣言的制約でエラーにする」が `kind` には適用されていない | マイグレーションで `CHECK (kind IN ('heart'))` を足すか、`fetchReactionSummaries` の WHERE に `AND kind IN (...)` を加えて未知の種別を落とす（読み取りが倒れるより、知らない種別を無視する方が壊れ方が良い）。B は oRPC の出力検証が実際に 500 になるかを一度実測して証跡に残すこと |
| Low | `apps/app/app/(tabs)/index.tsx:125-127` ＋ `apps/app/components/post-card.tsx:111-121` | 未認証（デモ閲覧）でも `onToggleReaction` を常に渡しており、ハートボタンが押せる。押すと `onMutate`（:42-61）で楽観的に赤くなり、サーバが FORBIDDEN を返して `onError`（:63-65）が黙って巻き戻す。**サーバ側は正しく拒否しており T5（UI側の制御に依存しない）は満たしている**ため境界の問題ではないが、失敗が完全に無言なので、本物の失敗（通信断・セッション切れ）も利用者に見えない。003/実機修正監査で記録済みの Low と同種 | デモ（未認証）ではボタンを出さないか押下不可にする。加えて `onError` で汎用の失敗表示を出す |
| Low | `apps/api/src/procedures/post.ts:262-283`（`post.delete`）＋ `apps/api/src/procedures/reaction.ts:25,44` | 投稿を論理削除しても `reactions` 行は残る。かつ DELETE/INSERT 双方が `deleted_at IS NULL` を条件に持つため、**削除後はそのリアクションを外す経路が存在せず、永久に残留する**。表示には出ないので漏洩ではないが、`security-requirements.md` 1節が「最高」区分とする投稿に紐づくメタデータが、削除操作の後も無期限に残ることになる | `post.delete` の `batch()` に `DELETE FROM reactions WHERE post_id = ?` を含める（`architecture.md` 4節の複数文は batch にまとめる方針と整合する）。残す判断をするなら理由をドキュメント化する |
| Info | `apps/api/src/index.ts:81-87`（レスポンスヘッダ） | oRPC の `encode` は `headers: {}` を返し（`server.CMf4nKky.mjs:131-135`）、API レスポンスに `Cache-Control: no-store` が付かない。POST 応答は既定でキャッシュされず、拡張子の無いパスは Cloudflare の既定キャッシュ対象外なので現状の実害は薄い。ただし上記 High（GET が通る）と組み合わさると、私的な投稿本文を含む `post.list` 応答がブラウザのディスクキャッシュに載る余地が生まれる | High の修正で主因は消える。あわせて `/api/*` に `Cache-Control: no-store` を付けておくと二重の防御になる |
| Info | `apps/api/src/procedures/reaction.ts:15` | `reaction.toggle` にレート制限が無い。ただし呼べるのは自ペアのメンバーのみで、影響は自分たちのデータと D1 の書き込みコストに閉じる。007監査で記録済みの Medium（`post.uploadUrl` のレート制限無し）と同じ論点 | 新規指摘としては扱わない。既存の未解決論点に含めて 016 で再評価 |

### 特に確認を求められた4点への回答

1. **`reaction.toggle` の認可境界 — 抜けなし。** DELETE（`reaction.ts:23-29`）と INSERT（`:42-48`）の両方に `EXISTS (SELECT 1 FROM posts WHERE id=?1 AND couple_id=?N AND deleted_at IS NULL)` があり、`postId` は同じプレースホルダ `?1` を EXISTS 側と本体側で共有しているため、片方だけ別IDを指す形にはならない。DELETE が0件でも INSERT 側で再度 couple_id を評価するので、「削除0件」を「付いていなかった」と誤解して無条件に INSERT する経路が無い。他ペアID・存在しないID・削除済みIDが全て同じ `NOT_FOUND` に収束しており（`:59`）、投稿の存在オラクルにもなっていない。契約（`packages/contract/src/reaction.ts:14`）の入力は `postId` と `kind` のみで、`packages/contract/src` 全体を grep しても `coupleId` は**コメントにしか現れない**。`test/reaction.test.ts:123-140` が「他ペアの投稿IDで NOT_FOUND、かつ `reactions` に行が作られない」ことを実際に検証している。
2. **レースの扱い — 設計として妥当。** 上表 Low に書いたとおり、境界は破れない（EXISTS が偽なら制約検査に到達しないため、UNIQUE 違反は自ペアの投稿でしか起こり得ない）。D1 にトランザクションが無い前提（`architecture.md` 4節）で「条件を WHERE に埋め、更新件数と宣言的制約で判定する」形になっており、方針と整合している。唯一の懸念は例外種別の判定が粗いこと。
3. **`fetchReactionSummaries` の範囲 — 認可を広げていない。** `post.ts:172-176` が渡す `postIds` は `couple_id = ?1` で絞った `pageRows`（`:149,158`）の id のみで、集計クエリ（`:65-74`）は `post_id IN (...)` だけを条件にしている。`reactions` を起点に引いたり `user` を起点に JOIN したりしていないので、`architecture.md` 5節の「`posts` を `couple_id` で絞った結果に対して行う。認可の範囲を JOIN で広げない」を満たす。`postIds.length === 0` で SQL を投げない分岐（`:60`）も、`IN ()` の不正 SQL を避ける正しい形。プレースホルダは全て bind で、SQL 文字列に値を連結していない（`?${i + 2}` は番号の生成のみ）。
4. **未認証（デモ）の `reactedByMe` — 漏洩なし。** `readProcedure` は未認証時に `userId: null`（`middleware/auth-context.ts:43`）を返し、`MAX(CASE WHEN user_id = ?1 ...)` は `?1` が NULL のとき比較が NULL に評価されて常に `ELSE 0` になる。`test/reaction.test.ts:246-269` が実データで `count: 1 / reactedByMe: false` を確認済み。加えて、認証済み利用者がデモペアを閲覧する経路そのものが存在しない（`auth-context.ts:46-52` は認証済みなら必ず自分の `couple_id` に解決する）ため、`reactedByMe` が他人の行動を示す余地は無い。`DEMO_COUPLE_ID` の `is_demo = 1` 実在確認（`:38-42`）も維持されている。

### 006 / 008 について確認し、指摘に至らなかった点

- `post.list` / `post.create` / `post.delete` の全クエリに `posts.couple_id = ?1` があり（`post.ts:149,158,229,265`）、`post.delete` は SELECT してから UPDATE ではなく `UPDATE ... WHERE ... RETURNING` の1文（`:262-269`）。`security-requirements.md` 3節の指示どおり。
- カーソルは署名されていないが（`post.ts:114-129`）、偽造しても WHERE の `couple_id` は外れないため自ペア内の位置がずれるだけ。`atob`/`JSON.parse` の失敗は `INVALID_INPUT` に落ちる（`:136-141`）ので、スタックトレースも SQL も外に出ない。
- 本文は Zod で 2000 文字上限（`packages/contract/src/post.ts:62`）。描画は RN の `<Text>`（`post-card.tsx:78,86`）のみで、`dangerouslySetInnerHTML` / `innerHTML` は `apps/` 全体に存在しない。
- `apps/` に `console.log` 等が1つも無く、投稿本文・`image_key`・トークンのログ出力は見当たらない（`post.ts:274-280` の R2 削除失敗も意図的に無言）。
- `apps/app/lib/query.ts:15` の `QueryClient` は永続化プラグインを持たず、投稿本文がディスクに残らない。
- `test/authorization.test.ts` の5項目に `reaction.toggle` が追加されており（:172-182, :267-272）、`:305-330` の「3基底のいずれかを経由しない手続きが無い」機械的検査も手続き数 12 で更新されている。005監査 Low（手動列挙の網羅性）に対する構造的な歯止めとして機能している。
- `.dev.vars` は `.gitignore:15-16` で除外され、`!.dev.vars.example` のみ例外。今回の差分に鍵・パスワードのハードコードは無い。

### 静的ツール

今回 `pnpm audit` / gitleaks の出力は渡されていないため、依存関係の判定は行っていない。`security-requirements.md` 9節の無視リスト（`image-size` 2件）の再評価は 016 の全体監査で行う前提のまま。

---

**総括: High 1件（CSRF: 書き込み手続きが GET で実行できる）、Low 4件、Info 2件。**
009 固有の認可設計（ご質問1〜4）については**指摘なし**。他ペアへの水平権限昇格の経路は見つからなかった。High はスコープ上 006〜009 に限らず API 全体に及ぶが、009 で書き込み手続きが1つ増えたことで露出面が広がっているため、M2 のうちに塞ぐことを勧める。
