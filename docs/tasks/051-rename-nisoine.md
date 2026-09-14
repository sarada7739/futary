# 051: プロダクト名を Nisoine に変える（ドメイン以外）

## 目的

**人間の指示。`futary` → `Nisoine`。キャッチコピーは「日々が、ふたりの記録になる。」。**
**ドメイン（`workers.dev` の URL）と、利用者に見えない中の名前は変えない。**

- 絵は `docs/sample/nisoine/`: `icon-1024.jpg`（N とハート。1024×1024）・`wordmark-on-checkerboard.jpg`（`Nisoine` の文字。**市松模様が焼き込まれた JPG。透過ではない**）
- 読み（カタカナ）は決まっていない。書かない

## 0. 先に決めたこと（A）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | 何を変えるか | **利用者に見える名前と絵だけ**（1節）。**中の名前は変えない**（2節） | 見えないものを変えても、失うもの（設定・履歴）と手間だけが増える |
| 2 | 過去の記録 | **書き換えない**（`docs/` の過去のタスク・worklog・リリース履歴の「futary リリース 🎉」は当時の名前のまま）。`requirements.md`・`architecture.md`・`CLAUDE.md` の冒頭に「旧名 futary。2026-09-15 に Nisoine に」の 1 行 | `conventions.md` 9節「過去の記録と現在の定義を分ける」 |
| 3 | ワードマークの透過 | **B が濃い茶の画素だけを抜いて透過 PNG にする**（市松と文字は色が離れている）。縁が汚ければ人間に透過 PNG を頼む（停止条件） | 人間の絵は JPG |
| 4 | ホームのロゴ | **ピンクもホワイトも同じワードマーク画像**にする（濃い茶はどちらの背景でも読める）。ホワイトの文字ロゴ（`home-logo-text`）はやめる | 2 通り持つ理由が無くなった。039 の文字ロゴは `futary` の手書き風を文字で出す工夫だった |
| 5 | OGP | **B が組む**（1200×630。今の `ogp.png` と同じ構図: 生成りの背景・ワードマーク・「日々が、ふたりの記録になる。」・「ふたり専用SNS」）。日本語のフォントは Windows の游ゴシック等。出自を `docs/sample/README.md` に | 人間の絵に OGP は無い |
| 6 | アイコン | `icon-1024.jpg` → `icon.png`（1024）・`apple-touch-icon.png`（180）・`favicon.png`（48）・Android のアイコン（前景 512。背景はアイコンの地の色）。**角丸は付けない**（OS が付ける） | — |
| 7 | リリース履歴 | **3.0.0「Nisoine になりました」**。「futary は Nisoine（ニソイネ）になりました」ではなく読みは書かない → 「アプリの名前が Nisoine になりました / 見た目と機能はそのままです」。`route` 無し。**048 段階2 は 3.1.0 に** | 名前が変わるのは大きい変更。版を上げる |
| 8 | Google OAuth の同意画面のアプリ名 | **人間が変える**（Google Cloud Console） | 私たちには触れない |
| 9 | 順序 | 048 段階2（決済）より前。iOS より前 | 名前は Stripe の商品名・App Store に乗る |

## 1. 変えるもの

### 名前（文字）

| 場所 | 今 | 後 |
|---|---|---|
| ランディング `index.html`: `title`・`description`・`og:*`・`twitter:*`・本文・フッター | `futary（ふたり） - ふたり専用SNS` / 「ふたりの毎日を、もっと特別に。」 | `Nisoine - ふたり専用SNS` / **「日々が、ふたりの記録になる。」** |
| アプリ `+html.tsx`: `apple-mobile-web-app-title`・`<title>` | futary | Nisoine |
| `app.json`: `name` | futary | Nisoine（`slug`・`scheme` は**変えない**。中の名前） |
| ダウンロードのファイル名（041）・ZIP 名（048） | `futary-YYYYMMDD-…jpg` / `futary-….zip` | `nisoine-…` |
| 外部 fetch の `User-Agent`（040） | `futary-link-preview/1 (+URL)` | `nisoine-link-preview/1 (+URL)` |
| デモの帯・オンボーディング・サインイン等、画面の中の「futary」の文字 | — | Nisoine（`git grep` で拾う。**テストの期待値も**） |
| `CLAUDE.md` の 1 行目・`requirements.md`・`architecture.md` の冒頭 | futary | Nisoine + 旧名の 1 行 |
| `README.md` | futary | Nisoine + 旧名の 1 行 |

### 絵

| ファイル | 元 | 備考 |
|---|---|---|
| `packages/ui/assets/logo-mark.png` | ワードマーク（透過にしたもの） | 今と同じ縦横比で幅 600px 程度。ホームの両モードで使う（0節 #4） |
| `apps/landing/assets/logo.png` | 同じ | |
| `apps/landing/assets/ogp.png` | B が組む（0節 #5） | |
| `apps/app/assets/icon.png`・`apple-touch-icon.png`・`favicon.png`・`android-icon-*.png` | `icon-1024.jpg` | 0節 #6。`splash-icon.png` は触らない（iOS のときに） |
| `docs/sample/README.md` | — | 出自（人間の絵 2 枚・B が組んだもの） |

## 2. 変えないもの

| | 理由 |
|---|---|
| Worker 名・URL（`futary-api.sarada7739.workers.dev`）・`BETTER_AUTH_URL`・`TRUSTED_ORIGINS`・CSP・R2 の CORS | ドメインのときに 1 回で（人間の指示） |
| パッケージ名 `@futary/*`・`pnpm` のフィルタ・CI・リポジトリ名・worktree のフォルダ名 | 見えない。133 ファイルを触る価値が無い |
| `localStorage` / `sessionStorage` の鍵（`futary.appearance` 等） | 変えると外観の設定と「見た」が消える |
| R2 のバケット名・D1 の名前・オブジェクトのキー | 移送になる。見えない |
| `app.json` の `slug`・`scheme` | Expo の識別子。iOS のときに考える |
| 過去の `docs/`・worklog・リリース履歴の旧項目 | 0節 #2 |
| コード中のコメントの「futary」 | 触らない（差分を膨らませない） |

## 3. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | 画面に出る文字列に「futary」が無い（ランディングの HTML・`+html.tsx`・`app.json` の `name`・画面の文言）。`git grep -i futary -- apps/landing/index.html apps/app/app apps/app/components apps/app/lib/releases.ts` の結果を証跡に（3.0.0 より前の項目と、コメントは除く） | 目視 + `apps/app` |
| T2 | ダウンロードの `filename` と ZIP 名が `nisoine-` で始まる | `apps/api`・`apps/app` |
| T3 | `User-Agent` が `nisoine-link-preview/1` | `apps/api` |
| T4 | ホームのロゴが両モードで同じ画像（`home-logo-text` が無い） | `apps/app` |
| T5 | `releases.ts` の先頭が 3.0.0 | `apps/app` |
| T6 | ワードマークの透過 PNG: 四隅が透明で、文字の画素が不透明（PIL で確かめて `artifacts/051/` に数字） | 証跡 |

## 確認観点

- ランディング・ホーム（両モード）・iPhone のホーム画面アイコン（入れ直し）・OGP（X に URL を貼って絵が出る）
- ダウンロードしたファイル名

## 完了条件

- T1〜T6。`pnpm -r test`・型チェック・lint
- スクリーンショット（両モード × ホーム・ランディング・OGP の絵）
- 人間: Google OAuth の同意画面のアプリ名を Nisoine に（0節 #8）・実機でアイコンを入れ直す
- `state.md` / `worklog.md`

## 停止条件

- ワードマークの抜きが汚い（縁に市松が残る・文字が欠ける）→ 人間に透過 PNG を頼む。他は先に進める
- 日本語フォントが無くて OGP が組めない → 英字だけの OGP にして結果に書く。人間に絵を頼む
- ホワイトのホームで濃い茶のロゴが浮く → 文字ロゴを残してよい（結果に書く）

## 順序

050 の後。048 段階2（決済）・iOS より前。ドメインは別（人間が買ってから）。
