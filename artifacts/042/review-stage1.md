R から B へ。PR #305（042、head 29d2e8b）は受け入れ。必須修正は無い。**ただし A が #306（main 9bdd07d）で定義を 1 点変えた: 20 枚の上限は「保存」に掛け、選択には掛けない。**A は「#305 に積むか次の PR にするか B に任せる」と言っている。#305 に積むなら、そのコミットだけ見て確定する。次の PR にするなら、このまま squash merge してよい。この文を `artifacts/042/review-stage1.md` に一字一句保存すること。A にも送る。

# 042（PR #305）— R の判定

futary-R で 29d2e8b を checkout して実行した。app 414・型チェック・lint 緑。`package.json`・`pnpm-lock.yaml` に差分無し（T7）。触ったものは戻した。

## T1〜T7 と、壊して確かめたこと

`photo-download.ts`・`album-detail.tsx` を 5 通り壊し、全部で対応するテストが赤になった:
| 壊し方 | 赤 |
|---|---|
| 失敗した枚を飛ばさず例外を投げる | T4 の 5 本 |
| 0 枚でも `share` を呼ぶ | 「nothing」の 3 本 |
| 表示順ではなく選択順で渡す | T3（画面） |
| 「保存」を `canShare` に関係なく出す | T1（PC に出ない） |
| 上限を 21 に | T2 の 2 本 |

## 読んで確かめたこと

- `sharePhotos` は `refs` の順に `photo.downloadUrl` → `fetchPhotoFile` → `File`、揃った分を 1 回の `navigator.share`。041 段階2 の関数（`fetchPhotoFile`・`shareFiles`・`canShareFiles`）はそのまま使い、変えていない
- `canSelect = canWrite || canShare`。タイムライン・ゲストは `canShare` が真のときだけ「選択」が出て、バーは「保存」だけ。「編集」「カバーにする」「削除」「+」は `canWrite` に閉じたまま
- 共有中は「保存」を押せない（`shareProgress !== null`）。結果の 4 分岐（shared / aborted / nothing / 例外）は 3節どおり
- API・契約・設計文書に差分無し。CSP・CORS は 041 段階2 と同じ前提

## A の定義変更（#306）について

B が決めたこと 1（共有シートのある環境では削除・カバーの選択にも 20 枚が掛かる）は、A が「上限は保存に掛け、選択には掛けない」と決めた。直すなら: `toggleSelect` の上限判定を外し、「保存（N 枚）」を `selected.size > MAX_SHARE_FILES` で無効にして 1 行（「一度に保存できるのは 20 枚までです」）を出す。T2 はその形に書き換える。**`sharePhotos` 自身にも `refs.length > MAX_SHARE_FILES` なら投げる保険**を置くと、画面の判定が外れても lib で止まる（今は画面だけが上限を持っている。記録 1）。

## 記録（判定に使わない）

1. `sharePhotos` は `MAX_SHARE_FILES` を自分では確かめない（画面が守っている）。上の定義変更のついでに lib 側にも置くとよい
2. 20 枚の `fetch` は直列で、iPhone の一時的な activation の窓を超えうる。タスク定義 2節の段階0（2 タップの形）で受ける前提どおり。私は確かめていない

## 私が確かめていないこと

- 人間の iPhone での段階0（5 枚・20 枚）。`spike.md` は未測定のまま
