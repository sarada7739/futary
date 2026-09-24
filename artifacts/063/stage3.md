# 063 段階3: テストと、テストファイルの中のコメント

`docs/tasks/063-prune-comments-and-tests.md`。テスト（0節 #6〜#9）とテストファイルのコメント（0節 #1〜#3。段階1・2 と同じ基準）。

## T3: テストの本数と結果

`pnpm -r test`（全部緑）:

| | 前（main 4e4a7ce） | 後 |
|---|---|---|
| packages/ui | 23 | 23 |
| packages/date | 67 | 68 |
| packages/db | 32 | 32 |
| apps/app | 631 | 630 |
| apps/api | 786 | 780 |
| 計 | 1,539 | **1,533** |

- **消した: 7 本**（api 6・app 1）。1 本ずつ `removed-tests.md` の「段階3」
- **`it.each` にまとめた: `it` 29 本 → `it.each` 7 つ（30 件）**。date が +1 なのは、2 つの値を 1 本で見ていた「月が範囲外」を 1 行ずつに分けたため
- **残った: 1,533 件**

型検査（`pnpm -r run type-check`）・lint（`pnpm run lint`）緑。

## T4: 0節 #6 のテスト

消した 7 本は、LP の文言・CSS（5 本）・ホームの文言（1 本）・投稿一覧の消した項目（1 本）。認可・couple_id・セキュリティヘッダ・CSP・レート制限・退会・スキーマ・課金・持ち出し・規則の走査のテストは 1 本も消していない。`auth.test.ts` の 4 本（BETTER_AUTH_URL の許可）は消さずに `it.each` にまとめた（確かめる 4 つの URL は同じ）。

## テストの中身を変えたもの（消す・まとめる以外）

1. **`apps/api/test/weather.test.ts`: 祝日の年を本物の今日ではなく写しの年（2026）で引く。** 「同梱の表に今年と来年の祝日がある」等 3 本が `new Date().getFullYear()` を使っていた。同梱の表（`packages/date/src/holidays.ts`）は 2026・2027 年の分だけなので、**2027-01-01 に「来年（2028）」が無くて赤くなる**時限式だった（#431 と同じ形）。`NOW_YEAR = new Date(NOW_MS).getUTCFullYear()` で引く。題名も「写しの年（2026）と翌年」に。同梱の表を 2028 年以降へ延ばすかは本番の話で、このテストの外（外部の JSON が取れれば上書きされる）
2. **`apps/app/test/viewer-key-coverage.test.ts`: 免除 2 箇所の固定を、行番号から行の中身に。** 段階2 の記録 1。`timeline.tsx:55:33` → `timeline.tsx (getQueriesData): const previousQueries = queryClient.getQueriesData<…>({` の形。確かめたこと:
   - `timeline.tsx` の先頭に 1 行足しても緑（行がずれても赤くならない）
   - `setQueryData(key, data)` の行の中身を変えると赤（場所の固定は効いている）
   - どちらも確かめたあと `timeline.tsx` は元に戻した（差分に無い）

## コメントの前後の数

測り方（段階1・2 と同じ）:

```
git grep -hE '^[[:space:]]*(//|/[*]|[*]|[{]/[*])' <ref> -- <dir> | wc -l
```

| 範囲 | 前（main） | 後 |
|---|---|---|
| `apps/api/test` | 1,102 | **771** |
| `apps/app/test` | 1,018 | **678** |
| `packages/date/test` | 33 | **24** |
| `packages/ui/test` | 14 | **12** |
| 計 | 2,167 | **1,485**（−682。約 31%） |

段階1・2 より減りが小さいのは、テストのコメントの多くが「何を確かめるか・なぜその形で確かめるか」（0節 #1 の理由）だったため。消したのは主に経緯（「以前は〜」「〜で発覚」）・誰が言ったか（「R の指摘」「security-auditor 指摘」「A の決定」「人間の指示」）・何回目か・コードの言い換え。

道具が読む注記の数は前後で同じ: `viewer-key-coverage-ignore` 7・`eslint-disable` 1・`@ts-expect-error` 2・`@ts-ignore` 0。

## コメント以外が変わっていないこと

`node artifacts/063/scripts/compare-code.mjs origin/main apps/api/test apps/app/test packages/date/test packages/ui/test packages/db/test`:
- コメント以外が同じ: **51 ファイル**
- コードが違う: **9 ファイル** = 上の「消した」「まとめた」「中身を変えた」の 9 ファイルだけ（`auth`・`landing`・`post`・`stats`・`weather`・`home-screen`・`viewer-key-coverage`・`white-stage2`・`date`）

## 消さなかったもの（迷ったので残した。0節 #9）

| ファイル | 名前 | 残した理由 |
|---|---|---|
| `apps/api/test/plan-lock.test.ts` | 猶予は 30 日 | 一見 (b) だが、他のテストは `LOCK_GRACE_SECONDS` を使うので 30 という仕様の値を固定しているのはこれだけ |
| `apps/api/test/link-preview.test.ts` | 上限は 12 秒 | 同じく、他は `TOTAL_TIMEOUT_MS` を使うので値の固定はこれだけ |
| `apps/api/test/link-preview.test.ts` | 楽天: charset を無視して UTF-8 で読むと題名が化ける | (c) にも見えるが、復号を Content-Type の charset で選んでいる（本文の meta を見ない）ことの裏側の確認 |
| `apps/api/test/ai.test.ts` | モデル名は環境変数から来ない（:73）と、openai の既定モデルは gpt-5.6-luna（:233） | 重なりは openai 側だけ。:73 は anthropic 側と「2 つが違う」も見ている |
| `apps/app/test/releases.test.ts` | 最新は 3.3.0 … | 出したときの文言を変えない（3.2.0・3.1.0）ことも固定している |
| `apps/app/test/glass-tab-bar.test.tsx` | filter / WebkitFilter の宣言も無い … url( が無い | (a) に見えるが、iPhone の Safari が壊れた絵にする書き方を戻さない番人（061） |

## 判断は R（記録）

- 059 の LP のテストは、T2 の「案内の 3 行」・T3 の grid・T4・T5 は残した（056・054 に同じ検査が無い）
- テストの題名（`it("…")`・`describe("…")` の文字列）は、中身と合わなくなったものだけ直した（`landing.test.ts` の 054 T4 の 1 本と 059 T2・T3 の describe、`weather.test.ts` の 1 本、`it.each` にまとめたもの）。それ以外の題名の中の経緯（「R の必須修正1」等）は触っていない。題名は失敗時の見出しで、変えるとテストの識別が変わる。直すかは A・R
