# 056: LP の中でデモを触れるようにする（スマホの枠に `/app/` を埋め込む）

## 目的

**人間の指示（2026-09-16）。トップページにスマホの絵を置き、その画面の中で本物のデモ（ゲストモードの `/app/`）を操作できるようにする。**

- 枠の絵: `docs/sample/landing/phone-frame.png`（1024×1536。AI 生成。画面は黒）
- LP は JS 無しのまま（054 の 0節 #13）。`<iframe>` は JS を要らない
- 同じオリジン（`nisoine.com`）なので、デモの API・画像はそのまま動く

## 0. 決めたこと（A）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | `frame-ancestors` | **`'none'` → `'self'`**（HTML 全部。人間の了承 2026-09-16） | 自分のオリジンからだけ框に入れられる。他サイトからは今まで通り拒む（クリックジャッキングの実害は無い）。`/app/*` だけ `'self'` にする分岐は作らない（HTML は全部 Worker の同じ関数で、分けると規則が 2 つになる） |
| 2 | デモに直接入る入口 | **`/app/?demo=1`**。未認証で開いたとき、サインイン画面を経ずにゲストモードで始まる（`isGuestMode` の初期値を `true` に）。**認証済みなら無視**（普通に自分のペアが出る） | 訪問者に「ゲストではじめる」を押させない。サーバ側の拒否は変わらない（`security-requirements.md` 3節。このフラグは見せ方だけ） |
| 3 | 框の中のログイン | **框の中（`window.top !== window.self`）では、サインイン画面に行く代わりに親ページを `/app/` に飛ばす**（`window.top.location.assign("/app/")`）。`exitGuestMode`・デモの帯の「ログイン」・書き込みの UI から戻るときの全部 | Google が iframe の中の OAuth を拒む。框の中でサインイン画面を出しても押せない |
| 4 | 置き場所 | **ヒーローの直後に節「さわってみる」**（`id="demo"`）。「基本機能は無料」の統計カード（054）は残す | 上で見た例（ゆい & れん・576 日目）が下で動いている形 |
| 5 | 読み込み | `<iframe src="/app/?demo=1" loading="lazy" title="Nisoine のデモ">`。**768px 未満では節ごと `display: none`**（スマホの中にスマホを出さない。既存の「ログインせずにデモを見る」に任せる） | 初回表示の速さ（015）。アプリの JS はそこまでスクロールしてから読む |
| 6 | 大きさ | iframe は **390×844** で描き、CSS の `transform: scale()` で枠の画面に合わせて縮める（`transform-origin: top left`。B が絵の画面の割合を測って倍率を決める。0.8 前後）。枠の表示幅はそれに合わせる（500px 前後） | アプリはスマホ幅で設計してある。390 より狭く描かない |
| 7 | 枠の重ね方 | 絵の**画面部分を透明に切り抜き**（PIL。黒の矩形をアルファ 0 に。加工の手順は `artifacts/056/scripts/`）、iframe の**上に** `pointer-events: none` で重ねる。ノッチは絵のまま（アプリの上端をノッチが少し隠すのは、スマホと同じ） | 角丸と縁の影を絵に任せる |
| 8 | `sandbox` | **付けない** | 同じオリジンで、付けると Cookie・`window.top` が壊れる |
| 9 | 見出し・文言 | `さわってみる` / `ゆいとれんのデモです。投稿は見るだけで、書き込みはできません。` / 下に `自分たちで始める →`（→ `/app/`） | 054 の 3 節と同じく、ここに無い文言は足さない |
| 10 | デモペアの負荷 | 何もしない。LP の訪問者がスクロールした分だけ `couple.get` 等の読み取りが増える。既存のレート制限のまま | 読み取り専用。問題が出たら測ってから |
| 11 | OGP・sitemap | 触らない | 節が増えるだけ |

## 1. B の作業

- `apps/api/src/lib/security-headers.ts`: `frame-ancestors 'self'`。テスト `canonical-host.test.ts` の固定値（68 行の CSP・302 行）を `'self'` に
- `apps/app`: `?demo=1` でゲストモードの初期値を `true`（Web のみ。`_layout.tsx`）。框の中でのサインイン画面への遷移を親ページの `/app/` に置き換える（0節 #3）。**入口は 1 箇所**（`showAuth` が立った瞬間に框の中なら親を飛ばす。ボタンごとに書かない）
- `apps/landing/index.html`・`style.css`: 節「さわってみる」（0節 #4〜#7・#9）。`assets/phone-frame.png`（透明に切り抜いた PNG。**150KB 以下**を目安。超えるなら幅 1024 → 800 に）
- `docs/sample/README.md` の `landing/` の表に `phone-frame.png` の行は A が足した
- `docs/security-requirements.md` 7節・`architecture.md` 3節（`/app/?demo=1`）は A が直した

## 2. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | `/`・`/app/`・`/privacy` の CSP に `frame-ancestors 'self'`（`'none'` が無い）。他のディレクティブは 053 T4b と同じ値 | `apps/api` |
| T2 | 未認証で `?demo=1` → サインイン画面を出さずデモ（ゲストの帯あり）。`?demo=1` 無し → サインイン画面（今まで通り） | `apps/app` |
| T3 | 認証済みで `?demo=1` → 自分のペア（デモにならない） | `apps/app` |
| T4 | 框の中（`window.top !== window.self` を差し替え）で `exitGuestMode` → `window.top.location.assign("/app/")` が呼ばれ、サインイン画面は出ない。框の外では今まで通りサインイン画面 | `apps/app` |
| T5 | `/` の HTML に `<iframe` が 1 つ、`src="/app/?demo=1"`・`loading="lazy"`・`title` あり・`sandbox` 無し。`<script` は無いまま（054 T2） | `apps/api` |
| T6 | `assets/phone-frame.png` の画面部分が透明（中央の画素のアルファが 0）・縁は不透明 | `scripts` か `apps/api` |

## 完了条件

- T1〜T6。`pnpm -r test`・型チェック・lint
- `wrangler dev` で `/` を 1280px 幅で開き、枠の中でデモがスクロール・タブ切り替えできる。デモの帯の「ログイン」を押すと**親ページ**が `/app/` に移る（框の中でサインイン画面が出ない）。375px 幅では節が出ない。画面キャプチャを `artifacts/056/`
- 本番デプロイ後、人間が `https://nisoine.com/` で触る
- `state.md` / `worklog.md`

## 停止条件

- `loading="lazy"` の iframe が `display: none` でも読まれてスマホの初回表示が重くなる → 768px 未満は iframe を出さず、CSS では隠せないので **`<picture>` のように分けられない**。その場合は節を残して iframe を `<a href="/app/">` の絵に替える案を `state.md` に書いて A へ
- 框の中で Cookie（Better Auth のセッション）が効かず、デモの `couple.get` が通らない → A へ（同じオリジンなので起きないはず。起きたら原因を書く）
- レビュー往復 3 回 → A へ

## 順序

047 の後。iOS・メール認証の前（小さい）。
