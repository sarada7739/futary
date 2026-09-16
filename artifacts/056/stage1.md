# 056: LP の中でデモを触れるようにする（スマホの枠に `/app/` を埋め込む）— 実装の報告

2026-09-16 / セッションB。タスク定義 `docs/tasks/056-demo-in-phone-frame.md`（main 41e4701）。
**人間の指示（実装中。2026-09-16）: 框の中に実ユーザーのデータが写る経路を塞ぐ**（ログイン中のブラウザで LP を開いても框の中は常にデモ）。

## 変えたもの

| 場所 | 何を |
|---|---|
| `apps/api/src/lib/security-headers.ts` | `frame-ancestors 'none'` → `'self'`（0節 #1。HTML 全部）。`canonical-host.test.ts` の固定値（053 T4b の `_headers` と 302 行）も `'self'` に |
| `apps/app/lib/demo-frame.ts`（新規） | `isDemoEntry()`（`?demo=1`）・`isInFrame()`（`window.top !== window.self`。触れなければ true）・`leaveFrameToApp()`（`top.location.assign("/app/")`）・**`frameCredentials()`（框の中は `"omit"`、外は `"include"`）** |
| `apps/app/lib/orpc.ts` `auth-client.ts` | fetch の `credentials` を `frameCredentials()` に。**框の中では API と認証（`get-session`）に Cookie を送らない** → サーバから見て未認証 = 常にデモペア。ネイティブは `isInFrame` が false で今まで通り |
| `apps/app/app/_layout.tsx` | `isGuestMode` の初期値を `isDemoEntry()`（0節 #2。Web だけ）。`isAuthenticated = !!session && !inFrame`（二重の守り: 万一セッションが見えても框の中を実ユーザーの画面にしない）。`showAuth && inFrame` で `leaveFrameToApp()`（0節 #3。入口は 1 箇所） |
| `apps/landing/index.html` `style.css` | ヒーローの直後に節「さわってみる」（`id="demo"`。0節 #4・#9）。iframe 390×844 を `scale(0.8)`、枠の絵を上に `pointer-events: none`。767px 以下は `.demo { display: none }` |
| `apps/landing/assets/phone-frame.png` | `docs/sample/landing/phone-frame.png` を幅 800 に（120KB。1024 だと 746KB）。**人間の絵は画面と外側が最初から透明**（B が測った）ので切り抜きは無し。`artifacts/056/scripts/make-assets.py` |
| `apps/api/vitest.landing-assets.ts`（新規） | 054 の仮想モジュールを別ファイルに。PNG のアルファ（`node:zlib` で読む。依存を足さない）と `style.css` の本文も渡す（vitest は CSS を空にするので `?raw` では読めない） |

### 倍率の根拠（0節 #6・#7）

枠の絵 1024×1536 の画面（透明）は x 208〜814・y 114〜1427 = **606×1313**（比 2.166。390×844 は 2.164）。ノッチは x 335〜693・y 114〜166。
iframe 390×844 を 0.8 に縮めると 312×675。絵を幅 **527px**（= 312 / 606 × 1024）で置くと画面にぴったり重なる（iframe は left 107px・top 59px）。

## テスト

| # | 何を | どこで | 結果 |
|---|---|---|---|
| T1 | `/` `/app/` `/privacy` の CSP に `frame-ancestors 'self'`。他は 053 T4b の固定値と同じ | `canonical-host.test.ts`（固定値を `'self'` に） | 緑 |
| T2 | 未認証 `?demo=1` → サインイン画面を出さずゲストの (tabs)。無し → サインイン画面 | `apps/app/test/demo-frame.test.tsx` | 緑 |
| T3 | 認証済み `?demo=1`（框の外）→ 自分のペア | 同上 | 緑 |
| T4 | 框の中で `exitGuestMode` → `top.location.assign("/app/")`。`?demo=1` 無しで框の中に開いても親を飛ばす。框の外はサインイン画面 | 同上 | 緑 |
| 追加 | `frameCredentials()`: 外 include・中 omit。**框の中でセッションが見えても認証済みとして扱わずデモのまま** | 同上 | 緑 |
| T5 | `<iframe` が 1 つ（`src="/app/?demo=1"`・lazy・title・sandbox 無し）。`<script` 無し。節の文言。767px の `display: none`・`pointer-events: none` | `landing.test.ts` | 緑 |
| T6 | `phone-frame.png`: 中央・画面の下・外側（左上）のアルファ 0、左の縁とノッチは > 200。150KB 以下 | `landing.test.ts`（仮想モジュールの PNG 読み） | 緑 |

`pnpm lint`・`pnpm type-check`・`pnpm test`（api 736・app 576・db 32・date 67・ui 16）すべて緑。

## 画面と計測（`artifacts/056/`。`scripts/capture.mjs`。`build:public` の出力を `wrangler dev` で）

| ファイル | 何 |
|---|---|
| `pc-demo-home.png` | 1280 幅。框の中にデモのホーム（563 日目。043 の「新機能のお知らせ」のシートがゲストの初回と同じく出る） |
| `pc-demo-home-closed.png` `pc-demo-calendar.png` | シートを閉じてタブ「カレンダー」→ 框の URL が `/app/calendar` |
| `pc-after-login-click.png` | 帯の「ログイン」→ **親ページ**が `/app/`（サインイン画面）。框の中にサインイン画面は出ない |
| `pc-logged-in-frame-is-demo.png` | **ログイン中（shot-couple のセッション Cookie）**: 親の `/app/` は本人（894 日目・member）、框の中はデモ（563 日目・ゲストの帯） |
| `mobile-375-top.png` `capture.json` | 375 幅: `#demo` は `display: none`。下まで一度スクロールしても `/app/` への request が 0（lazy の iframe は隠れていれば読まれない。停止条件に当たらない）。横スクロール無し |

`capture.json` の `loggedIn.frameApiRequests`: 框の中からの `couple.get`・`auth/get-session`・`stats.get` の 3 つとも **Cookie ヘッダ無し**（`frameApiWithCookie: 0`）。

## B が決めたこと

- **框の中は常にデモ**（人間の指示）。0節 #2 の「認証済みなら無視（自分のペア）」は框の**外**で `?demo=1` を開いたときだけ（T3）。実装は「框の中では Cookie を送らない」（本体）+「框の中では `isAuthenticated` を false に」（二重の守り）。定義の書き換えは A
- iframe の中は Playwright の座標クリックが `transform: scale` でずれる（Playwright の制約）ので、撮影は `dispatchEvent("click")` で押した。本物のブラウザの操作はずれない
- 043 の「新機能のお知らせ」のシートは框の中でもゲストの初回に出る（既存の挙動。塞いでいない）
- ノッチがデモの帯（「このデモは…」「ログイン」）の中央を隠す（絵のまま。0節 #7）。右端の「ログイン」は見える

## 停止条件の確認

- lazy: 375 幅で `display: none` の iframe は読まれない（計測）。PC では節がヒーローの直下なので初回から読まれる（想定どおり）
- Cookie: 框の中の `couple.get` は通る（未認証 = デモ）。「Cookie が効かない」の逆で、意図して送っていない
