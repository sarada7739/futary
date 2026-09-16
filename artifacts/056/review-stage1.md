# 056（PR #398。fc7c086 まで）— R の判定

futary-R で fc7c086 を checkout して実行した（`.dev.vars` は CI と同じダミー）。ui 16・date 67・db 32・app 576（+ T3b の `orpc-frame-credentials` 2）・api 736 全部緑。`tsc --noEmit` 緑・`eslint .` 緑。`worklog.md` は追記のみ。触ったものは戻した。

**判定: 差し戻し。必須修正 1（A の判断）。**

## 必須修正

### 1. 框の中でデモの読み込みが失敗すると、利用者が何も押していないのに LP（親ページ）が `/app/` へ飛ぶ

`_layout.tsx` の経路: `?demo=1` でゲスト → `couple.get` が失敗（通信断・API の 5xx・デモペアの解決失敗。`retry: false`）→ `demoFailed` → `setIsGuestMode(false)` → `showAuth` → **`showAuth && inFrame` で `leaveFrameToApp()`** → `top.location.assign("/app/")`。

使い捨てのテストで再現した（削除済み）: 框の中・`?demo=1`・`couple.get` が reject → `top.location.assign("/app/")` が呼ばれ、`(tabs)` は出ない。

LP を開いた訪問者は、框の中のデモが一瞬でも読めなかったら、読んでいた LP ごとサインイン画面に連れて行かれる。014 の R-1 で `demoFailed` を「サインイン画面へ落とす」形にしたのは框の外の話で、框の中ではその落とし先が親ページの遷移になる。0節 #3「`showAuth` が立った瞬間に框の中なら親を飛ばす（入口は 1 箇所）」がこの経路まで拾っている。

**A に決めてほしい形**（案）: 框の中で親を飛ばすのは**利用者の操作**（`exitGuestMode` = 帯の「ログイン」・書き込み UI から戻る）だけにし、`demoFailed` は框の中では親を飛ばさず、框の中に「デモを読み込めませんでした」（今の `demoUnavailable` の 1 行）を出したまま止める。実装は `leaveFrameToApp()` を `exitGuestMode` に置く（`useEffect(showAuth && inFrame)` をやめる）か、`useEffect` の条件に `!demoUnavailable` を足すかの 2 通り。前者は「入口は 1 箇所」が `exitGuestMode` に移るだけ。テスト: 框の中で `couple.get` が reject → `assign` が呼ばれない。

## 壊して確かめたこと

| 壊し方 | 赤 |
|---|---|
| 框の中でも Cookie を送る（`frameCredentials` を include に） | 1 本（T3b） |
| 框の中でもセッションを認証済み扱い | 1 本（T3b） |
| 框の中で親を飛ばさない | 2 本（T4） |
| `?demo=1` を無視 | 4 本（T2） |
| `frame-ancestors` を `'none'` に戻す | 3 本（T1 + 053 T4b の固定値） |

## 読んで確かめたこと

- 0節 #1: `buildCsp` の 1 箇所。固定値の比較（053 T4b）も `'self'` に
- 人間の指示（框の中は常にデモ。#399 で定義に）: `orpc.ts`・`auth-client.ts` の fetch が `frameCredentials()`（框の中 omit）。`_layout` の `isAuthenticated = !!session && !inFrame` の二重の守り。T3b は本物の `lib/orpc.ts` の fetch の `init.credentials` を見ている。`capture.json` の `frameApiWithCookie: 0`
- `isInFrame` は `top` に触れなければ true（クロスオリジンの親）。`'self'` しか許していないので普通は来ないが、来ても Cookie を送らない向き
- 0節 #4〜#7・#9: 節「さわってみる」の文言は定義どおり。`<iframe src="/app/?demo=1" loading="lazy" title …>`・`sandbox` 無し・`<script` 無し。枠の絵は幅 800（120KB）。767px 以下は `display: none`（375 幅で `/app/` への request 0 = 停止条件に当たらない）
- 0節 #8: `sandbox` 無し

## 記録（判定に使わない）

1. 043 の「新機能のお知らせ」のシートが框の中でもゲストの初回に出る（B の報告どおり。既存の挙動）。LP の訪問者が最初に見るのがお知らせのシートになる。塞ぐかは A
2. ノッチがデモの帯の中央を隠す（0節 #7 の「絵のまま」どおり）

## 私が確かめていないこと

- 本番の `https://nisoine.com/` で人間が触る（完了条件）
- 画面は `capture.json` の数字を読んだだけで PNG は見ていない

## 追加コミット 04a81a9（A の #400。必須修正 1）— R の判定

futary-R で 04a81a9 を checkout して実行した。app 581 緑・`tsc --noEmit` 緑・`eslint .` 緑。

**受け入れ。必須修正 1 は閉じた。**

- 差し戻しのときの使い捨てのテストを再実行: 框の中・`?demo=1`・`couple.get` が reject → **`top.location.assign` は呼ばれず**、`(auth)` も出ず、框の中に `frame-fallback`（「デモを読み込めませんでした」+「アプリを開く」）。削除済み
- 壊して確かめた（`demo-frame` + `home-releases` 30 本）: `exitGuestMode` で親を飛ばさない → 1 本赤（T4）、框の中でも `(auth)` を出す → 2 本赤（T4b）、框の中でもシートを開く → 1 本赤（T7）、框の中でも `releaseSeen` を書く → 1 本赤（T7）、**`useEffect(showAuth && inFrame)` の形に戻す → 3 本赤**（T4b が拾う。同じ形に戻れない）
- 読んで: 親を飛ばすのは `exitGuestMode` の 1 箇所（帯の「ログイン」・書き込み UI から戻る）。0節 #3b の 1 行は `showAuth && inFrame` のオーバーレイで、「アプリを開く」は `href="/app/"` + `target="_top"`（JS 無しで親を開く。利用者の操作）。0節 #3c: `index.tsx` は框の中でシートを開かず、`markReleaseSeen`・`deferRelease` は框の中では書かない（同じオリジンの storage を框で汚さない）。記録 1 も閉じた

### 記録（判定に使わない）

- 無し
