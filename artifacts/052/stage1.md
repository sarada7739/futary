# 052: プライバシーポリシーと利用規約のページ — 実装の報告

2026-09-15 / セッションB。タスク定義 `docs/tasks/052-legal-pages.md`。文面は `docs/legal/privacy-policy-draft.md`・`terms-draft.md`（人間が空欄を埋めた版。main 09fb936）を **変えずに** 写した。

## 変えたもの

| 場所 | 何を |
|---|---|
| `apps/landing/privacy.html`・`terms.html`（新規） | 草案を HTML に。`style.css` の既存クラスだけ（`.hero`/`.logo`/`.tagline`・`.container`・`h2`・`.tech-intro`・`.decisions`/`.decision`（節ごとのカード）・`.footer`）。**新しい CSS は書いていない**（表・箇条書きはブラウザ既定）。`<title>`・`description` は付けた（定義「無くてよい」。`noindex` は無い）。inline script 無し。ヘッダのロゴは `/` へのリンク。フッターに トップ・プライバシーポリシー・利用規約 |
| `apps/landing/index.html` | フッターに「プライバシーポリシー ・ 利用規約」 |
| `scripts/build-public.mjs` | `privacy.html`・`terms.html` を `index.html` と同じ `cpSync` で写す（停止条件「構造を変える必要」には当たらなかった。2 行足しただけ） |
| `apps/app/components/legal-links.tsx`（新規） | 2 つのリンクの行。`Linking.openURL(getApiOrigin() + "/privacy")`。ページは `/app/*` の外にあるので expo-router の `Link` ではなく `Linking`（Web は新しいタブ）。`testID` `legal-privacy`・`legal-terms` |
| `apps/app/app/(auth)/sign-in.tsx` | ボタン列の一番下に `<LegalLinks />` |
| `apps/app/app/(tabs)/profile.tsx` | ログイン後: 「アカウントを削除」の下。ゲスト: ログイン案内の「ログイン」ボタンの下（ゲストにも読める） |
| `apps/api/src/lib/ai.ts` | コメント: OpenAI のデータ共有は **オフ**にする（052。人間がダッシュボードで）。ポリシー 3 節「学習には使われません」の実体。無料枠から外れるが 037 の歯止めの範囲。ADR-013 の同意文言と一致 |

## A の判断で直したこと（2 コミット目。R の受け入れ dd4db9c の後）

- **利用規約の節番号を詰めた**（9→8、10→9、11→10。A の判断。番号だけで文面は変わらない。草案側は A が合わせる。048 で足すときに振り直す）。`check-text.py` は見出しの節番号を比べないようにした（`norm()`）
- **表の包み**: `<div class="table-wrap">` で 2 つの表を囲み、`style.css` に `.table-wrap { overflow-x: auto }` と `.table-wrap table { min-width: 560px }`。**包みだけでは列が狭いまま**（日本語は 1 文字ずつ折り返せるので表が画面幅まで縮む。実測）なので最小幅を持たせた。さらに `.decision` に `min-width: 0`（grid の子は `min-width: auto` で、表に引きずられてカードごと 608px に広がり画面の外へ出ていた。実測して直した。`index.html` のカードは中身が折り返せるので見た目は変わらない）。結果: 包み 294px の中で表 560px が横にスクロールし、ページの `scrollWidth` は 390

## B が決めたこと（A へ。急がない）

- 節ごとに `.decision` のカードで区切った（`h3` の色・余白がこれにしか付いていないため。裸の `h3` だとブラウザ既定の太字だけになる）
- `/privacy.html` は 307 で `/privacy` へ（Cloudflare の `html_handling=auto-trailing-slash` の正規化。`index.html` と同じ扱い）
- 表の最小幅 560px と `.decision` の `min-width: 0` は A の「包み 1 つだけ」より多い。「列を狭めたままにしない」を満たすために要った（上）。減らすなら A の判断

## テスト

| # | どこ | 結果 |
|---|---|---|
| T1 | `stage1/t1.txt`（`pnpm build:public` → `wrangler dev` に `curl`） | `/` `/privacy` `/terms` とも **200・text/html**。`<title>`・`h2` が入っている。`/terms` に「8. プレミアム」「048 で足す」は無い。`/` のフッターに 2 リンク。CSP は `_headers`（`index.html` と同じ） |
| T2 | `stage1/t2.txt` | `grep -c '【'` は両方 **0**。加えて `scripts/check-text.py`（草案の md と HTML の文面を、強調・表・箇条書きを剥がして行ごとに比較。md 側は引用・A のメモ・8 節を除く）で **privacy 73 行・terms 40 行とも一致** |
| T3 | `stage1/t3.txt`・`apps/app/test/sign-in-screen.test.tsx`（新規 2 件）・`profile-screen.test.tsx`（052 の 2 件） | 押すと `Linking.openURL(\`${getApiOrigin()}/privacy\`)` / `/terms`。サインイン・遷移は巻き込まれない。実ブラウザ（`scripts/shots.cjs`）でも sign-in → 新しいタブ `http://localhost:8787/privacy`、profile(guest) → `/terms` |

`pnpm lint`・`pnpm type-check`・`pnpm test`（ui 16 / date 66 / db 32 / app 538 / api 626）全て緑。

## 見た目

`stage1/landing-privacy.png`・`landing-terms.png`（390px。全画面）・`landing-footer.png`・`app-sign-in.png`・`app-profile-guest.png`。

## 人間の手番（デプロイ後）

1. Google の OAuth 同意画面に `https://…/privacy` を登録（アプリのホームページの URL も）
2. OpenAI のダッシュボードでデータ共有（入力・出力の共有）をオフ
