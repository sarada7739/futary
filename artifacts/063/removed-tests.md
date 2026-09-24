# 063: 消したテスト

1 本ずつ「ファイル・名前・0節のどれか・代わりに守っているテスト」。

## 段階1（0節 #10 のデッドコードと一緒に消えたもの）

| ファイル | 名前 | 0節 | 代わりに守っているテスト |
|---|---|---|---|
| `apps/app/test/glass-tab-bar.test.tsx` | G6「theme.ts の filterId が全部 +html.tsx に定義されている」 | #10（検査の対象の `filterId`・`glassFilter()` を消した） | G5「この部品で SVG フィルタ（url()）を使わない」（`url(` が部品に無いので、+html.tsx の定義との食い違いは起こらない） |
| `packages/ui/test/theme.test.ts` | T5「filterId は外観ごとに別」 | #10（`filterId` を消した） | T5「キーが両モードで同一」（残りの glass のキーの一致） |

0節 #6（必ず残すテスト）に当たるものは無い。

## 段階3

| ファイル | 名前 | 0節 | 代わりに守っているテスト |
|---|---|---|---|
| `apps/app/test/home-screen.test.tsx` | 「COMING SOON」「準備中です」「次フェーズ」という文言がどこにも出ない | #7(a) | 同じファイルの「パネルが 9 枚で、並びは …」（今のラベルを完全一致で固定）・`white-stage2.test.tsx` の「feature-panel.tsx は appearance を読まない（062 T2）」（ソースに `COMING SOON` が無い） |
| `apps/api/test/post.test.ts` | post.list に imageUrl（単数）が残っていない | #7(a) | 同じファイルの「画像付きの投稿は署名付きGET URLを含む」「画像の並び順が position のとおりに返る」（今の `images` の形）。契約（`packages/contract`）の出力スキーマに `imageUrl` が無い |
| `apps/api/test/landing.test.ts` | 059 T1「`/` の HTML に hands-cafe が無い。assets/ に hands-cafe.jpg が無い」 | #7(a)(b) | 054 T4「10 枚がある（役割の名前）」（JPEG の一覧を完全一致）・「index.html が参照する /assets/ のファイルは全部ある」（HTML が hands-cafe を参照すれば、実体が無いので赤） |
| `apps/api/test/landing.test.ts` | 059 T2「iframe（056 T5 のまま）と、説明の文言（「ゆいとれん」は無い）」 | #7(a)(b) | 056 T5「<iframe が 1 つ。src=/app/?demo=1 …」（iframe・説明の文言・節の開始タグを同じ文字列で確かめている） |
| `apps/api/test/landing.test.ts` | 059 T2「ボタン <a class="btn btn-primary" href="/app/">自分たちで始める</a>。<script は無いまま」 | #7(a)(b) | 056 T5 の同じテスト（同じボタンの文字列と `<script` が無いこと）・054 T2「<script が無い」 |
| `apps/api/test/landing.test.ts` | 059 T3「.ai-band-photo が無い（PC・720px 未満の両方）。.demo-more も無い」 | #7(a) | 059 T3「.demo-inner の grid-template-columns: 527px 1fr」（今の CSS）。消したクラスの規則が残っても見た目は変わらない（`apps/landing` に `ai-band-photo`・`demo-more` は 0 件）ので、戻る経路を守るテストは要らない |
| `apps/api/test/landing.test.ts` | 059 T3「767px の .demo { display: none } はそのまま（056 T5）」 | #7(b) | 056 T5「768px 未満は節ごと display: none」（同じ正規表現） |

0節 #6（必ず残すテスト）に当たるものは無い。

### it.each にまとめたもの（0節 #8。確かめる値は減らしていない）

| ファイル | 前 | 後 |
|---|---|---|
| `apps/api/test/auth.test.ts` | 「BETTER_AUTH_URL が http://localhost / http://127.0.0.1 / https / http://[::1] なら許可される」4 本 | `it.each` 1 つ（4 件） |
| `apps/api/test/stats.test.ts` | computeDaysTogether の dating 5 本・married 4 本（今日・昨日・明日・2 日後・年またぎ） | `it.each` 1 つ（9 件） |
| `apps/app/test/white-stage2.test.tsx` | 機能パネルの white / pink の対 3 組 | `it.each(["white", "pink"])` 3 つ（6 件）。部品は外観を読まないので同じ検査。描画側の「COMING SOON が無い」は外し、ソースの検査（062 T2）に寄せた |
| `packages/date/test/date.test.ts` | isValidDate 6 本 | `it.each` 1 つ（7 件。「月が範囲外」の 2 値を 1 行ずつに分けた） |
| `packages/date/test/date.test.ts` | isLeapYear 4 本 | `it.each` 1 つ（4 件） |
