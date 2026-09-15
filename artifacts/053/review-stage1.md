# 053（PR #373）— R の判定

futary-R で 18a905f を checkout して実行した。api は R のツリーに `.dev.vars` が無いので、`deploy.yml` の CI 用と同じダミー値（gitignore 済み。秘密ではない）を置いて走らせ、**26 ファイル 653 テスト全部緑**（ダミー無しだと `BETTER_AUTH_SECRET` 起因の 19 件が赤になるだけ）。`tsc --noEmit` 緑・`eslint .` 緑。`worklog.md` は追記のみ。触ったものは戻した（ダミーの `.dev.vars` は残している。リポジトリの外）。

**判定: 受け入れ。必須修正なし。マージは「マージの前に」の 2 つのあと。**

## マージの前に（タスク定義 1節 #2・#3。人間の許可）

main へのマージはそのままデプロイなので、**先に** `wrangler secret put BETTER_AUTH_URL` / `TRUSTED_ORIGINS` を `https://nisoine.com` にし、`pnpm r2:cors:apply` を流してからマージする。逆にすると:
- 新ドメインで開いた画面からの `POST /api/auth/*` は、Better Auth の origin の検査（`baseURL` と `trustedOrigins` に無いオリジン）で弾かれ、Google の戻り先も旧ホストの `/api/auth/callback/google` = 053 の 403 になる。**secret を直すまで新ドメインでログインできない**
- R2 の CORS が旧オリジンのままだと、新ドメインからの写真の PUT/GET（`fetch`）が CORS で落ちる
secret を先に直したあと、デプロイまでの数分は旧ホストのログインが同じ理由で通らない。許可が出たら **secret → cors:apply → マージ** を続けてやるのがよい。

## 壊して確かめたこと（`canonical-host.test.ts` + `cors.test.ts` 30 本）

| 壊し方 | 赤 |
|---|---|
| `*.workers.dev` を旧ホストに含めない | 5 本 |
| 旧ホストの `/api/*` も 301 にする | 3 本（T3） |
| 301 でクエリを落とす | 2 本（T1・T2） |
| HSTS を外す | 7 本 |
| CSP から `frame-ancestors 'none'` を外す | 3 本（T4b） |
| HTML 以外にも CSP を付ける | 2 本（T4c） |
| `src` 付きの `<script>` もハッシュに含める | 3 本 |
| ハッシュのキャッシュの鍵から ETag を外す | 1 本 |
| 固定ヘッダを `/api/*` だけに戻す | 6 本 |

## 読んで確かめたこと

- 0節 #1: `routes` 2 つ `custom_domain = true`・`workers_dev = true`
- 0節 #2: `isLegacyHost` は `www.nisoine.com` と `.workers.dev` の末尾一致。`/api/*` は 403 + `{"error":"LEGACY_ORIGIN","message":"nisoine.com で開き直してください"}`、他は 301 で同じパス・同じクエリ。`localhost` は素通り（ローカルの動作を変えない）
- 0節 #3・#4: `r2-cors.json` は新オリジンだけ。T6 で `TRUSTED_ORIGINS=https://nisoine.com` だけの CORS。secret は人間
- 0節 #5（A が e8cfbc3 で直した形）: `run_worker_first = true`。固定ヘッダは一番外側の middleware で全応答に。CSP は `app.all("*")` の fallback で ASSETS binding の応答を複製し、HTML・200 のときだけ、配信する HTML の inline script（`src` 無し）から sha256 を計算して付ける。`buildCsp` の中身は移行前の `_headers` と同じ文字列（T4b が固定値で比較。`/app/` は完全一致、`/`・`/privacy` はランディングに inline script が無いぶんハッシュ 2 つが付かない = 狭い方向）。R2 のホストは `env.R2_ACCOUNT_ID` から。無ければ足さない（fail-closed）
- キャッシュ: パス + ETag で 1 度だけ。上限 256 で全消し。ETag が無ければ毎回計算（正しさは変わらない）。ヒット時は binding の本文（stream）をそのまま流す
- middleware の順: 固定ヘッダ → 旧ホスト判定 → `/api/*` の CORS → Better Auth → RPC → fallback。`/api/*` で一致しないものは binding に渡さず 404（テスト有り）
- `build-public.mjs`: `_headers`・`buildCsp`・`readR2AccountId` を消し、「inline script は 2 本・全ページ同じ」の留め金は残っている（ハッシュはログに出る）。`t1-t5.txt` で `wrangler dev` の `/app/` の CSP のハッシュがビルドのログの 2 本と一致
- 0節 #8: `robots.txt`（`/api/`・`/app/` Disallow・Sitemap）・`sitemap.xml`（3 URL）・`canonical`。T5 は `apps/landing` の実ファイルを `?raw` で読む
- 0節 #12: UA の URL が `https://nisoine.com`
- 18a905f（A の判断）: `deploy.yml` の「デプロイ」から `R2_ACCOUNT_ID` の env を消しただけ。`build-public.mjs` に `R2_ACCOUNT_ID` の参照は 0（grep）。CI 用の `.dev.vars` の行は署名付き URL のテストが読むので残っている。**本番の Worker の `R2_ACCOUNT_ID` は 053 の前から署名付き URL（`r2-signed-url`）が `c.env.R2_ACCOUNT_ID` で読んでいる secret**なので、CSP も同じ値から組める（本番の secret の有無は私からは見えない。写真が今動いていることが根拠）

## 記録（判定に使わない）

1. **`http://nisoine.com/` を Worker は https に寄せない**（`isLegacyHost` は `nisoine.com` を素通りし、HSTS は最初の https 訪問のあとでしか効かない）。Cloudflare のゾーンの **SSL/TLS → Edge Certificates → 「Always Use HTTPS」** をオンにしておくと初回の http も 301 される。人間の手番に 1 行足すとよい（ゾーンの既定値は私は確かめていない）。A へ
2. プレビュー URL（`<version>-futary-api…workers.dev`）も本番へ 301 する（B の報告どおり）。プレビューを見たくなったときに困る。今は要らないので記録だけ
3. HSTS の `includeSubDomains` は `nisoine.com` の全サブドメインに掛かる。今後サブドメインを作るときは https 前提（Cloudflare なら困らない）
4. ハッシュのミス時は `res.text()` で読んで文字列の本文で返す（`Content-Encoding` が付いていても Workers の既定の `encodeBody: "automatic"` で再エンコードされる）。`wrangler dev` では通っている（`t1-t5.txt`）。本番の初回リクエストは人間の手番 #6 の実機で分かる

## 私が確かめていないこと

- 本番の Custom Domain の作成（`wrangler deploy`。停止条件）・旧ホストの 301（`wrangler dev` では再現できない。B の報告どおり単体テストで固定）・実機のログイン → 投稿 → 写真 → 保存
- 本番の secret（`R2_ACCOUNT_ID`・`BETTER_AUTH_URL`・`TRUSTED_ORIGINS`）の値
- Cloudflare ゾーンの「Always Use HTTPS」の既定値（記録 1）
