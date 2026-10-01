# 066: 依存の既知脆弱性に追随する（undici・brace-expansion・hono）と、Dependabot の失敗を止める

`docs/tasks/066-deps-security-undici.md`。

## pnpm audit の前後

| | high | moderate | low |
|---|---|---|---|
| 前（main 4226eaa） | **9**（undici 7・brace-expansion 2）＋無視リストの image-size 2 | 16 | 6 |
| 後 | **0**（無視リストの image-size 2 だけ） | 4 | 0 |

残る moderate 4 は 0節 #7 のとおり触っていない: esbuild（GHSA-67mh-4wv8-2f99）・uuid（GHSA-w5hq-g745-h8pq）・decode-uri-component（GHSA-vcc3-ghjq-m6fr）・fflate（GHSA-px8p-9vwx-vf98）。

- `node scripts/pnpm-audit.mjs --audit-level=high`: 終了コード 0
- `node scripts/check-audit-ignore-staleness.mjs`: 「無視リストの2件は、いずれも現在のaudit結果に存在します（陳腐化なし）」

## 上げたもの

| 依存 | 前 | 後 | どこ | 0節 |
|---|---|---|---|---|
| `wrangler` | ^4.126.0 | **^4.146.0**（miniflare 5.20261001.0-alpha。undici 7.29.1・sharp 0.35.4） | `apps/api` devDependencies | #1 |
| `@cloudflare/vitest-plugin` | ^1.1.0 | **^1.3.4**（miniflare 5.20260930.0-alpha。undici 7.29.1・sharp 0.35.4） | `apps/api` devDependencies | **定義に無い。**下 |
| `@cloudflare/workers-types` | ^5.20260825.1 | **^5.20261001.1** | `packages/db` devDependencies | **定義に無い。**下 |
| `jsdom` | ^30.0.1 | **^30.1.1**（undici ^8.10.2 → 8.11.2） | `apps/app` devDependencies | #2 |
| `hono` | ^4.13.5 | **^4.13.12** | `apps/api` dependencies（本番） | #4 |
| `brace-expansion` | 5.0.9 | **5.0.12**（`pnpm update -r --depth=Infinity brace-expansion minimatch` で上がった。override は足していない） | 推移的（minimatch 10.2.6） | #3 |

定義に無い 2 つ:
- **`@cloudflare/vitest-plugin`**: 1.1.0 は `miniflare@5.20260825.0-alpha`（undici 7.29.0 固定）と `wrangler@4.126.0` を依存に持つ。wrangler だけを上げても、テスト用のこの経路に undici 7.29.0 が残り、high が消えない（T2 も満たせない）。1.3.4 は miniflare 5.20260930.0-alpha（undici 7.29.1・sharp 0.35.4）
- **`@cloudflare/workers-types`**: wrangler 4.146.0 が peer で `^5.20261001.1` を求める（`pnpm peers check` で新しく出た警告）。`packages/db` だけが宣言している

## override

- **消した**: `"sharp@<0.35.4": "0.35.4"`（0節 #5。コメントの条件「miniflare が sharp>=0.35.4 を宣言する版」を満たした）。消した後も lockfile の sharp は **0.35.4** だけ
- **足していない**: brace-expansion（update で 5.0.12 に上がった）
- 残る: `"js-yaml@<4.3.2": "4.3.2"`（触っていない）

`security-requirements.md` 9節の override の表は A が直す。

## minimumReleaseAgeExclude（pnpm-workspace.yaml）

pnpm が公開から 1 日たっていない版を入れるときに自動で足す: `wrangler@4.146.0`・`miniflare@5.20261001.0-alpha`・`workerd@1.20261001.1` と各 OS の `@cloudflare/workerd-*@1.20261001.1`・`@cloudflare/workers-types@5.20261001.1`。lockfile から消えた版（`hono@4.13.5`・`miniflare@5.20260825.0-alpha`・`wrangler@4.126.0`）は外した。

## T2: lockfile

```
undici@7.29.0: 0 件   undici@8.10.0: 0 件   hono@4.13.5: 0 件   hono@4.13.6: 0 件
undici@7.29.1・undici@8.11.2・hono@4.13.12・sharp@0.35.4・brace-expansion@5.0.12
wrangler@4.145.0（vitest-plugin の中）・wrangler@4.146.0・miniflare@5.20260930.0-alpha・miniflare@5.20261001.0-alpha
```

## T3: テスト・型検査・lint

`pnpm -r test`: ui 23・date 68・db 34・app 630・api 783 = **1,538**（前と同じ）。type-check・lint 緑。

**依存と関係ない赤を 1 つ直した**: `apps/api/test/memory.test.ts` の「どの節目にも無いが7日以上前の投稿があれば、ランダムに1件返る」が今日（2026-10-02）落ちた。投稿を `addDays(todayJst(), -30)` に置いていて、前の月が 30 日の月（今日は 10 月）だと 30 日前 = 1 ヶ月前（09-02）になり、`random` ではなく `oneMonthAgo` が返る。**main でも同じく落ちる日付依存**。10 日前に置く形に直した（10 日前は 1 ヶ月前・半年前・1 年前のどれとも重ならず、7 日以上前の条件は満たす）。他の `-30` のテストはラベルを見ていない。

## T4: wrangler dev（4.146.0）

`pnpm build:public` → `api-dev`（`wrangler dev`）→ `node artifacts/066/scripts/check-dev.mjs <cookie>`（Cookie は `artifacts/045/scripts/make-session.mjs` がローカル D1 に作る撮影用ペア）:

```
OK   GET / — 200・CSP あり
OK   GET /app/ — 200・CSP あり
OK   POST /api/auth/sign-in/social（google） — 200・https://accounts.google.com/o/oauth2/v2/…
OK   GET /api/auth/get-session（ログイン中） — 200・user shot-user-me
OK   POST /api/post/create — 200
OK   POST /api/post/list に今の投稿がある — 200
OK   未認証の post.create は拒まれる — 403
OK   POST /api/auth/sign-out — 200
OK   ログアウト後の get-session は空 — 200・null
9 / 9 OK
```

ブラウザでも `http://localhost:8787/app/` がサインイン画面まで描けることを見た。**Google の画面には進んでいない**（ログインの入口が accounts.google.com への URL を返すところまで。往復はセッションの取得 → 投稿 → ログアウト → 取得できない、で見た）。本物の Google ログインは本番デプロイの後に人間が見る。

## Dependabot（0節 #6）

`.github/dependabot.yml`: `package-ecosystem: npm`・`directory: /`・`schedule: weekly`・`open-pull-requests-limit: 0`・`ignore: image-size`（理由と消す条件をコメントに）。効いたかは、デプロイ後の Dependabot の実行で `undici`・`image-size` の失敗が出ないことを人間が Actions で見る。

## peer の警告（記録）

`pnpm peers check` に残るのは `react-native-worklets`（expo-modules-core が ^0.7〜^0.10 を求め、0.12.1）と `@react-native/metro-config`（0.86.2 を求め、0.87.0）。この PR で変えた依存とは関係ない（`apps/app` の Expo 側。触っていない）。
