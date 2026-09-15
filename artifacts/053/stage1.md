# 053: 独自ドメイン `nisoine.com` へ移す — 実装の報告

2026-09-15 / セッションB。タスク定義 `docs/tasks/053-custom-domain.md`（A が e8cfbc3 で 0節 #5・T4b・T4c を足した版）。

## 変えたもの

| 場所 | 何を |
|---|---|
| `apps/api/wrangler.toml` | `workers_dev = true`（明示）・`routes = [nisoine.com, www.nisoine.com]`（`custom_domain = true`）。**`run_worker_first = true`**（それまで `["/api/*"]`。配列だと一致するアセットのあるパスは Worker を通らず、旧ホストの `/` を 301 できない。Cloudflare の文書で確認） |
| `apps/api/src/lib/canonical-host.ts`（新規） | `CANONICAL_HOST = "nisoine.com"`・`isLegacyHost`（`www.nisoine.com` か `*.workers.dev` の末尾一致。プレビュー URL も同じ扱い）・`canonicalUrlFor`（同じパス・同じクエリ）・403 の文言 |
| `apps/api/src/lib/security-headers.ts`（新規） | **セキュリティヘッダを Worker で付ける**。`run_worker_first = true` だと `_headers` は Worker の応答に効かない（Cloudflare の文書「Worker が生成した応答には適用されない」）ため。固定のヘッダ（nosniff・Referrer-Policy・**HSTS**）は全応答に。CSP は HTML にだけ付け、`script-src` のハッシュは **配信する HTML の inline script を読んで sha256 を計算**（`_headers` にあった CSP と同じ形。R2 のホストは `env.R2_ACCOUNT_ID`。無ければ足さない = 広げない）。**ハッシュはパス + ETag で 1 度だけ計算してモジュールのメモリに持つ**（A の条件 1。上限 256 で全消し） |
| `apps/api/src/index.ts` | 一番外側: 固定ヘッダの付与。次: 旧ホスト・www の判定（`/api/*` 以外 → 301、`/api/*` → 403 + `{"error":"LEGACY_ORIGIN","message":"nisoine.com で開き直してください"}`）。`/api/*` にだけあった nosniff の middleware は全応答のものに統合。最後: `app.all("*")` で `/api/*` 以外を `env.ASSETS.fetch` に渡し HTML に CSP（`/api/*` で一致しないものは 404 のまま）。`Bindings.ASSETS?: Fetcher` |
| `scripts/build-public.mjs` | `_headers` の生成・`buildCsp`・`readR2AccountId` を消した。**「inline script は 2 本・全ページ同じ」の留め金は残す**（`assertInlineScripts`。ハッシュはログに出す） |
| `apps/api/r2-cors.json` | `AllowedOrigins` の旧オリジンを `https://nisoine.com` に（**`r2:cors:apply` は未実行。人間の許可待ち**） |
| `apps/api/src/lib/link-preview.ts` | UA を `nisoine-link-preview/1 (+https://nisoine.com)` に |
| `apps/landing/robots.txt`・`sitemap.xml`（新規）・`index.html` | `/api/` `/app/` を Disallow・sitemap の 3 URL・`<link rel="canonical" href="https://nisoine.com/">`。`build-public.mjs` が 2 ファイルを写す |
| `apps/api/test/canonical-host.test.ts`（新規）・`cors.test.ts`・`test/fixtures/security-headers/app-index.html` | T1〜T6 |

## B が決めたこと（A へ）

- **`/` と `/privacy` の CSP は移行前より狭い**: 移行前は `_headers` の `/*` で app の 2 本のハッシュがランディングにも付いていた。ランディングには inline script が無いので、新しい CSP は `script-src 'self'` だけ（T4b はこれを「ハッシュ 2 つが無いだけで他は同じ」として固定。弱くなる方向ではない）。`/app/*` は完全一致
- 旧ホストの `/api/*` は **全メソッド 403**（OPTIONS も）。旧ホストのページは 301 するので、旧オリジンからの preflight が要る場面は無い
- `isLegacyHost` は `*.workers.dev` の末尾一致。プレビュー URL（`<version>-futary-api.sarada7739.workers.dev`）も本番へ 301 する（プレビューを見たいときは困る。要るなら `wrangler versions` の別の見方にする）
- `LEGACY_ORIGIN` の 403 は `c.json`（oRPC の形ではない）。開きっぱなしのタブの fetch が受け取るだけなので、アプリ側の表示は変えていない（旧タブは再読込すれば 301 で新オリジンへ）
- `ASSETS` が無い環境（テスト）では `/api/*` 以外は 404
- `deploy.yml` は触っていない（`R2_ACCOUNT_ID` を build に渡す行は残っているが、build はもう読まない。害は無い。A の判断で消してよい）

## テスト

| # | どこ | 結果 |
|---|---|---|
| T1 | `canonical-host.test.ts`「T1」3 件 | `GET https://futary-api.sarada7739.workers.dev/` → 301 `https://nisoine.com/`。`/app/x?y=1&z=2` → 同じパス・クエリ。プレビュー URL も |
| T2 | 同「T2」3 件 | `www.nisoine.com/terms?a=b` → 301。`nisoine.com` 自身と `localhost` は 301 しない |
| T3 | 同「T3」3 件 | 旧ホストの `POST /api/health/get` → 403・JSON・Location 無し。`/api/auth/get-session`・www も 403 |
| T4 | 同「T4」3 件 | API・静的アセット・301・403 の全部に HSTS `max-age=31536000; includeSubDomains` |
| T4b | 同「T4b」3 件 | **移行前の `_headers` を文字列で固定**（`LEGACY_HEADERS_FILE`）。`/app/`（移行前のビルドの `app/index.html` をフィクスチャに）は CSP を含む 4 ヘッダが完全一致。ハッシュはフィクスチャの inline script 2 本から自分で計算した値と一致。`/`・`/privacy` は上の「B が決めたこと」 |
| T4c | 同「T4c」2 件 | `.js` `.png` `/api/*` に CSP 無し。固定のヘッダはある |
| T5 | 同「T5」3 件 | `apps/landing` の実ファイルを `?raw` で読む偽の `ASSETS` 経由。robots は `/api/` `/app/` を Disallow・sitemap は 3 URL・`workers.dev` 無し |
| T6 | `cors.test.ts`「053 T6」 | `TRUSTED_ORIGINS=https://nisoine.com` だけで、新オリジンには ACAO・旧オリジンには無し |
| キャッシュ | `canonical-host.test.ts`「1 度だけ計算」2 件 | 同じパス+ETag の 2 回目はキャッシュの数が増えず本文はそのまま。ETag が変われば計算し直す |
| 実測 | `stage1/t1-t5.txt` | `pnpm build:public` → `wrangler dev` に curl。`/` `/app/` `/privacy` `/robots.txt` `/sitemap.xml` 200。**`/app/` の CSP のハッシュがビルドのログの 2 本と一致**。CSP・HSTS・nosniff が Worker から付いている（`_headers` は無い）。**旧ホストの判定はローカルでは再現できない**（wrangler dev が Host を localhost に書き換える）→ 単体テストで固定し、実機は本番で |

`pnpm lint`・`pnpm type-check`・`pnpm test` 全て緑（下の「検査」）。

## 人間の手番（B から示す値）

| # | いつ | 何 |
|---|---|---|
| 1 | 先 | Cloudflare のゾーン `nisoine.com` が **Active**（ネームサーバー反映待ち）。**Active になるまで `wrangler deploy`（= main へのマージ）は失敗する** |
| 2 | マージ前 | `cd apps/api && wrangler secret put BETTER_AUTH_URL` → `https://nisoine.com`、`wrangler secret put TRUSTED_ORIGINS` → `https://nisoine.com`（旧オリジンは入れない）。**許可をください** |
| 3 | マージ前 | `cd apps/api && pnpm r2:cors:apply`（`r2-cors.json` の新オリジン。旧を外す）。**許可をください** |
| 4 | デプロイ後 | Google Cloud Console: リダイレクト URI `https://nisoine.com/api/auth/callback/google`・JavaScript 生成元 `https://nisoine.com`・同意画面（承認済みドメイン `nisoine.com`、ホームページ `https://nisoine.com/`、プライバシー `https://nisoine.com/privacy`、規約 `https://nisoine.com/terms`）。**052 の「OAuth 同意画面に /privacy を登録」はここでまとめて**（旧 URL では登録しなくてよい） |
| 5 | デプロイ後 | **052 の OpenAI データ共有オフ**もこのタイミングでまとめて |
| 6 | デプロイ後 | `https://nisoine.com/` でログイン → 投稿 → 写真 → 保存。`curl -I https://futary-api.sarada7739.workers.dev/` が 301 `https://nisoine.com/`、`curl -I https://www.nisoine.com/` も 301。iPhone のホーム画面アイコンを入れ直す |
| 7 | デプロイ後 | Search Console に `nisoine.com` を登録し `https://nisoine.com/sitemap.xml` を送る |
| 8 | 1 週間後 | Google OAuth の旧リダイレクト URI を消す |

## A へ（起票の知らせ）

- `docs/architecture.md` 3節の URL の表・`security-requirements.md` 7節（`_headers`・CSP の置き場が Worker に移った。HSTS を付けた）の書き換えは A
