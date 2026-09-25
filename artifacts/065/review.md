# 065 — R の判定

futary-R で origin/task/065-ai-band-center（a8c91f5）を checkout。`landing.test.ts` 30 件 緑。`worklog.md` は追記のみ（削除 0 行）。

**受け入れ。必須修正なし。**

## タスク定義に無い 1 行（`.ai-band-copy { flex-grow: 0; }`）は必要

B の `measure.mjs` で、CSS を 3 通り R も測った（Chromium・375 / 1280）:

| CSS | 375 の文字 上・下 | 1280 の文字 上・下 |
|---|---|---|
| main | 24・84 | 64・64 |
| タスク定義の 2 行だけ | **24・84（動かない）** | 64・64 |
| B の版（+ `flex-grow: 0`） | **54・54** | 64・64 |

原因は B の説明どおり: 縦並びで `.ai-band-copy`（`flex: 1 1 auto`）が帯の高さいっぱいに伸び、文字がその箱の上端に置かれる。0節 #1 の「原因」の見立て（`space-between` が残っている）だけでは直らない。足した行は 720px の中だけで PC には効かない。**1280 幅は main と画素で完全に一致**（差分の範囲なし）。A への申し送りは state.md 7 行にある。

## その他

- 0節 #1: `.ai-band` は `justify-content: center`（`space-between` 無し）。#2: `.ai-band-copy p` に `text-wrap: balance`。#3・#4 は差分に無い
- T1 の 2 本目は `@media (max-width: 720px)` 以降の文字列を見るが、このメディアクエリは 1 つだけなので他の規則を拾わない

## 記録（判定に使わない）

1. 375 幅の説明は `balance` で「ふたりの 1 週間と 1 ヶ月 / を、AI が短く振り返ります。」と 2 行に揃ったが、**2 行目が「を、」で始まる**。前の「…振り / 返ります。」よりは良いが、日本語としては少し読みにくい。気になるなら文言か改行位置（`<wbr>` 等）の話で、A・人間の判断
2. 本番の iPhone Safari（`text-wrap: balance` は Safari 17.5 以降）は人間の手番

## 私が確かめていないこと

- Safari の実機
