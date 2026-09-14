# 043（PR #315）— R の判定

futary-R で c5a8645 を checkout して実行した。app 451・ui 16・型チェック・lint 緑。`package.json`・`pnpm-lock.yaml` に差分無し。触ったものは戻した。

## T1〜T6 と、壊して確かめたこと

`release-seen.ts`・`index.tsx`・`releases.tsx`・`card.tsx` を 6 通り壊し、全部で対応するテストが赤になった:
| 壊し方 | 赤 |
|---|---|
| ストレージが読めない環境で未読扱いにする | 0節 #9 の 2 本 |
| 「閉じる」で既読にしない | 閉じる・外・使ってみる の 3 本 |
| 「後で」で既読にする | 後で・次の起動・一覧で NEW が消える の 3 本 |
| 「後で」を無視してシートを出す | 後で の 1 本 |
| 一覧を開いても既読にしない | T4 の 2 本 |
| `Card` の `accent` を無視 | T5 の 2 本（両モード） |

## 読んで確かめたこと

- データは `releases.ts` の配列だけ。11 項目の version・date・title・route は A の表と一致（B の日付確認の表も読んだ。変えていない）。T1 が `route` の実在を `app/(tabs)/<name>.tsx` の `existsSync` で見ている
- 「見た」は `window.localStorage["futary.releaseSeen"]`、「後で」は `window.sessionStorage["futary.releaseLater"]`。比較は文字列一致。読めなければ既読扱い、書けなければ黙る。サーバ側の描画は false
- シートは `useEffect` で開く（hydrate の食い違いを避ける。039 と同じ判断）。画面ファイルの `appearance` の読みは 039 の 2 箇所のまま（`index.tsx` のロゴ）。シートの贈り物／星の分岐は部品（`release-sheet.tsx`）の中
- `Card` の `accent` は既定 false で、既存の呼び出しの描画は変わらない（ui の T1 も緑）
- オンボーディングにはボタンもシートも無い（T6）。ゲストにも出る（`readProcedure` を通らない。端末だけの話）
- API・契約・設計文書に差分無し

## 記録（判定に使わない。1 は A へ）

1. **「後で」の寿命は `sessionStorage` なので、同じタブの再読み込みでは出直さない。**0節 #4 の「次にアプリを開いたとき（ページ読み込み）にまた出す」と、2節の `sessionStorage` は少し違う: `sessionStorage` はタブが生きている限り再読み込みを越えて残る（iOS Safari はタブの復元でも残ることがある）。出直すのは「新しいタブで開いた」「タブを閉じて開いた」とき。B の `capture.json` は「後で → 一覧 → 戻る → 再読み込み」の順で、「後で → 再読み込み」は測っていない。実装は 2節どおりで穴ではないが、人間が「後で → 再読み込みで出る」を期待すると出ない。人間の実機確認の項目に「後で → 再読み込み（出ない）→ タブを閉じて開く（出る）」を入れると、期待と一致しているかがそこで分かる。A の判断
2. `useSyncExternalStore` の `getSnapshot` はレンダーのたびに `localStorage` を読む（`hasUnseenRelease()`）。軽いので実害無し

## 私が確かめていないこと

- 人間の実機（シート → 閉じる → 出ない）
- スクリーンショットの目視（ファイル一覧と `capture.json` の値は見た）
