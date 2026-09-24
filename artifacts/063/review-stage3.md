# 063 段階3 — R の判定

futary-R で origin/task/063-stage3（bce75e1）を checkout。変更 64 ファイルはすべてテスト・`artifacts/063/`・`docs/{state,worklog}.md` の中で、`src` には触っていない。`worklog.md` は分岐点（4e4a7ce）との比較で追記のみ（削除 0 行）。

**受け入れ。必須修正なし。**

## コメント以外が変わったファイル

R の構文木の葉の比較で、60 ファイル中コードが違うのは `auth`・`landing`・`post`・`stats`・`weather`（api）・`home-screen`・`viewer-key-coverage`・`white-stage2`（app）・`date`（packages/date）の 9 つだけ。B の報告と一致。残り 51 はコメントだけ。

## 消した 7 本（`removed-tests.md` の段階3 を 1 本ずつ）

- home-screen「COMING SOON 等が出ない」: 0節 #7(a) の例そのもの。「パネルが 9 枚で、並びは …」がボタンのラベルを完全一致で固定している（70 行）
- post「imageUrl（単数）が残っていない」: #7(a)。「画像付きの投稿は署名付きGET URLを含む」（421 行）・「画像の並び順」（432 行）が今の形を見ている
- landing の 059 の 5 本: 代わりのテストが実在し同じ文字列を見ている。054 T4「10 枚がある」（103 行。JPEG の一覧を完全一致）・「index.html が参照する /assets/ は全部ある」（130 行）・056 T5 の iframe・「デモ画面です。…」・ボタン・`<script` 無し（212〜225 行）・768px の `display: none`（230 行。同じ正規表現）・054 T2 の `<script` 無し（75 行）
- **0節 #6（必ず残す）に当たるものは 0 本。**`auth.test.ts` は `it.each` にまとめただけで、消えた検査は無い（T4）

## it.each（値を 1 つずつ前後で突き合わせた）

- auth: 許可する URL 4 つ（localhost・127.0.0.1・https・[::1]）がそのまま
- stats: dating 5・married 4 の日付・今日・期待値がそのまま。前準備（`couple({ datingDate })` / `couple({ primaryDate: "married", marriedDate })`）も元と同じ
- date: isValidDate 6 本 → 7 件（「月が範囲外」の 13 と 0 を別の行に）・isLeapYear 4 件がそのまま
- white-stage2: white/pink の 3 組 → 3 つ × 2。描画の「COMING SOON が無い」を外したのは、062 T2 のソースの検査（部品に `COMING SOON` が無い・外観を読まない）が同じことを確かめているので妥当
- ファイルごとの `it` の数の差は、上の 7 本とまとめた数でちょうど説明がつく（auth 16→13・landing 30→25・post 42→41・stats 25→17・home 14→13・white 15→12・date 67→59）

## 中身を変えた 2 つ

- weather: 祝日の 3 本が `new Date().getFullYear()` で同梱の表（2026・2027）を引いていたのを `NOW_YEAR`（写しの年）に。「来年」を引くテストが 2027-01-01 に赤くなる（2028 が表に無い）時限式を外した（#431 と同じ形の穴。段階1 の記録の答えになっている）
- viewer-key-coverage: 免除 2 箇所を「ファイル・メソッド・行の中身」で固定。行番号に縛られなくなり、呼び出しの行を変えれば赤になる（B が確かめた）

## 走らせたもの

中身の変わった 9 ファイル: api 5 ファイル 125 件・app 3 ファイル 93 件・date 68 件、全部緑。

## 記録（判定に使わない）

1. 迷って残した 6 本（`stage3.md`）は 0節 #9「迷ったら残す」どおり
2. `pnpm -r test` の全件（1,533）は R は回していない。取り込み後の CI で確かめる

---

## 追補 #440（f066795。テストの題名から経緯を消す）— R の判定

**受け入れ。必須修正なし。**

- `-U0` の差分の変更行 25 組は全部 `it(` / `describe(` の行で、変わったのは題名の文字列だけ。前準備・断言・`it.each` の値には触っていない
- 消えたのは 0節 #2 のもの（「R の必須修正1・2」「security-auditor 指摘」「M2まとめ監査」「R の段階1レビュー」「PR #177回帰」「R-1〜R-4」「A の指摘」「旧版の穴」「段階0・段階3」「当初は通していたが閉じた」「従来どおり」）。題名に残る理由（「2段階での迂回を防ぐ」「transform と同時だと Safari が背後を二重に描く」「5 秒では楽天が常に画像無しになる」「Levi's」「amzn.asia の短縮 URL」）は残っている
- 変えた題名で、同じファイル内の重複は新しく生まれていない（`post.test.ts` の「未認証なら FORBIDDEN」「ペアに未所属なら NEEDS_ONBOARDING」の各 3 回は main から同じで、手続きごとの describe に分かれている）
- 古い題名を `package.json`・`.github`・`scripts`・vitest の設定から参照しているところは無い（`-t` の絞り込み等で落ちない）
- `worklog.md` は追記のみ（削除 0 行）

記録（判定に使わない）: 「旧L30」は L 番号の参照だが「旧」の経緯ごと消えた。タスク番号・L 番号は残す方針（`titles.md`）との食い違いは小さく、題名の意味は変わらないので問わない。
