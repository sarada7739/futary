# 053: 独自ドメイン `nisoine.com` へ移す

## 目的

**人間が `nisoine.com` を買い、Cloudflare にゾーンを作った（2026-09-15）。本番の URL を `https://futary-api.sarada7739.workers.dev` から `https://nisoine.com` に移す。**

- 旧 URL は消さず、**新 URL へ 301**（古いリンク・X のカード・ホーム画面のアイコンが死なない）
- `www.nisoine.com` → `nisoine.com` に 301
- 中の名前（Worker 名 `futary-api`・バケット・D1）は変えない

## 0. 決めたこと（A）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | 付け方 | `wrangler.toml` に **`routes = [{ pattern = "nisoine.com", custom_domain = true }, { pattern = "www.nisoine.com", custom_domain = true }]`**。DNS と証明書は Cloudflare が作る | Workers の Custom Domains。手で DNS を書かない |
| 2 | 旧 URL | `workers.dev` は**残す**（`workers_dev = true` のまま）。Worker の先頭で `host` が `workers.dev` か `www.` なら **`https://nisoine.com` + 同じパスへ 301**。**`/api/*` は 301 しない**。旧ホストへの API 呼び出し（開きっぱなしの古いタブ）は **403 と「nisoine.com で開き直してください」**を返す | 「戻れる」を保つ。ただし Cookie は新オリジンに移らないので**ログインし直し**になる |
| 3 | `BETTER_AUTH_URL` / `TRUSTED_ORIGINS` | `https://nisoine.com` に。**旧オリジンは `TRUSTED_ORIGINS` から外す**（301 するので要らない） | 信頼するオリジンを増やさない |
| 4 | R2 の CORS | `r2-cors.json` の `AllowedOrigins` を `https://nisoine.com` に差し替え（旧を外す）→ `r2:cors:apply` | 同上 |
| 5 | CSP・HSTS | CSP は `'self'` 中心なので変わらない。**HSTS を付ける**（`max-age=31536000; includeSubDomains`。`workers.dev` は preload 済みだったが独自ドメインは自分で付ける。`build-public.mjs` の既存のコメントが根拠） | SSL ストリップ対策 |
| 6 | Google OAuth | 人間が **リダイレクト URI `https://nisoine.com/api/auth/callback/google`** と **JavaScript 生成元 `https://nisoine.com`** を足す。旧は**当面残す**（301 の間にログインが始まると旧 URI に戻るため。1 週間後に消す） | — |
| 7 | 同意画面 | 承認済みドメインに `nisoine.com`。ホームページ `https://nisoine.com/`、プライバシー `https://nisoine.com/privacy`、規約 `https://nisoine.com/terms` | 052 で登録した URL を差し替え |
| 8 | 検索 | `robots.txt`（`/api/` を Disallow、`/app/` を Disallow）・`sitemap.xml`（`/` `/privacy` `/terms`）・`<link rel="canonical" href="https://nisoine.com/">` を `index.html` に。人間が **Search Console** に登録して sitemap を送る | 独自ドメインになったので初めて意味がある |
| 9 | 端末 | ふたりの iPhone のホーム画面のアイコンを入れ直す。外観の設定・「見た」は新オリジンでは空（端末の `localStorage` はオリジンごと）。**移さない** | 1 度きり |
| 10 | リリース履歴 | 入れない（URL は機能ではない）。**ただし新機能のお知らせのシートは新オリジンで初回扱いになり、3.0.0 のシートが出る。それでよい** | — |
| 11 | メール（Resend 等）の送信元 | まだ。メール認証を起票するときに `nisoine.com` の DNS に SPF/DKIM を足す | 別のタスク |
| 12 | `User-Agent` の URL（040） | `nisoine-link-preview/1 (+https://nisoine.com)` に | 名乗る先が本物になる |

## 1. 人間の手番（順に）

| # | いつ | 何 |
|---|---|---|
| 1 | 先 | Cloudflare のゾーンが **Active** になる（ネームサーバー反映待ち） |
| 2 | B の PR のマージ前 | `wrangler secret put BETTER_AUTH_URL` / `TRUSTED_ORIGINS` の更新の許可（B が値を示す） |
| 3 | デプロイ後 | Google Cloud Console: リダイレクト URI・JavaScript 生成元・同意画面（承認済みドメイン・3 つの URL）。**0節 #6・#7** |
| 4 | デプロイ後 | `https://nisoine.com/` でログイン → 投稿 → 写真 → 保存、が通る（実機）。旧 URL を開くと新 URL に飛ぶ |
| 5 | デプロイ後 | Search Console に `nisoine.com` を登録し `sitemap.xml` を送る |
| 6 | 1 週間後 | Google OAuth の旧リダイレクト URI を消す |

## 2. B の作業

- `wrangler.toml` の `routes`（0節 #1）。`wrangler deploy` が Custom Domain を作る（ゾーンが Active でないと失敗する。**停止条件**）
- Worker の先頭に 301（0節 #2）。`/api/*` は旧ホストで 403 + 「nisoine.com で開き直してください」の JSON
- HSTS（0節 #5）
- `r2-cors.json`・`apply`（人間の許可）
- `.github/workflows/deploy.yml` の `BETTER_AUTH_URL` 等はローカル用の値なので触らない。**本番の secret は人間**
- `robots.txt`・`sitemap.xml`・`canonical`・`User-Agent`
- `docs/architecture.md` 3節の URL の表・`security-requirements.md` の `workers.dev` の記述は **A が直す**（B は起票して知らせる）

## 3. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | `Host: futary-api.sarada7739.workers.dev` の `GET /` `GET /app/x` → 301 `https://nisoine.com/`・`/app/x`。クエリも保つ | `apps/api` |
| T2 | `Host: www.nisoine.com` → 301 `nisoine.com` | `apps/api` |
| T3 | 旧ホストの `POST /api/...` → 403（301 しない） | `apps/api` |
| T4 | `nisoine.com` の応答に `Strict-Transport-Security` | `apps/api` |
| T5 | `robots.txt`・`sitemap.xml` が 200 で、`/api/` `/app/` が Disallow | `apps/api` |
| T6 | `TRUSTED_ORIGINS` に旧オリジンが無い状態で、新オリジンからの API が通る（既存の CORS の検査） | `apps/api` |

## 完了条件

- T1〜T6。`pnpm -r test`・型チェック・lint
- デプロイ後、人間の実機で 1節の 4
- `state.md` / `worklog.md`

## 停止条件

- ゾーンが Active でない → 待つ（B は PR まで作って止まる）
- `wrangler deploy` が Custom Domain の作成で失敗（ゾーンのアカウントと Worker のアカウントが違う等）→ A へ
- 301 と Better Auth のコールバックが干渉する（`/api/auth/callback/google` が旧ホストに戻ってくる）→ 0節 #6 の「旧 URI を当面残す」で逃げる。それでも駄目なら A へ

## 順序

052 の後。Cloudflare のゾーンが Active になってから B が着手。048 段階2・iOS の前。
