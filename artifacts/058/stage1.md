# 058: カレンダーに天気と祝日を出す — 実装の報告

2026-09-17 / セッションB。タスク定義 `docs/tasks/058-weather-and-holidays.md`（main f4c8d0d）。

## 変えたもの

| 場所 | 何を |
|---|---|
| `artifacts/058/scripts/make-tables.mjs` | 同梱の表 3 つを気象庁・内閣府の公開データから作る（手で直さない。作り直す）。元データは同梱しない（`.cache/` は gitignore） |
| `packages/contract/src/weather-areas.ts`（生成） | **142 の予報区（class10）**・47 の都道府県 → 予報区。予報区ごとに `office`（fetch する JSON）・`week`（週間の区域）・`amedas`（気温の観測点）。`isWeatherAreaCode` |
| `packages/ui/src/weather-codes.ts`（生成） | 気象庁の **118 の天気コード**（予報ページの `TELOPS`）→ 主 + 副の絵。名前から機械的に（主 = 最初の語、副 = 次の違う語、雷を含めば副 = 雷、霧 = 曇、みぞれ = 雪）。表に無いコードは主 = 曇 |
| `packages/date/src/holidays.ts`（生成） | 内閣府 `syukujitsu.csv` の 2026〜2027 年（35 日） |
| `packages/ui/assets/weather-*.png`・`components/weather-icon.tsx` | 絵 5 つ（**仮**。下）と `WeatherIcon`（主 28・副は右下に 16） |
| `packages/db` 0026 | `couple_members.weather_area TEXT`（NULL 可） |
| `packages/contract/src/weather.ts` | `weather.get`・`weather.getForDate`・`holiday.list`・`me.updateWeatherArea`。`couple.get.weatherArea` |
| `apps/api/src/lib/weather.ts` | 気象庁の JSON を Zod で検証し、短期（3 日）の天気コード + 週間（7 日）を合わせて今日から 7 日分。気温は今日 = 短期の `temps[1]`、他 = 週間の `tempsMax/Min`。office ごとに 1 時間キャッシュ（失敗は 10 分）。12 秒で打ち切り。失敗は `[]`。**週間の区域が細分区域をまとめるとき**（東京: 伊豆諸島北部 + 南部 → 伊豆諸島）は `week_area.json` のコード → 細分のコード → 名前の前方一致 → 最初の区域の順で倒す |
| `apps/api/src/lib/holidays.ts` | 同梱の表 + holidays-jp の JSON（1 日 1 回。失敗は 1 時間）。外部が取れれば上書き、同梱にしか無い日は残す |
| `apps/api/src/procedures/weather.ts`・`me.ts`・`couple.ts` | 1 節の 4 つ。ゲストは東京地方（`130010`）で固定。`context.externalFetch` でテストが fetch を差し替える |
| `apps/app/lib/weather.ts`・`components/weather-area-sheet.tsx`・`month-grid.tsx`・`calendar.tsx`・`profile.tsx` | 2 節: 月表示に絵 + 最高気温（今日から 7 日）・祝日の赤・帯「天気の地域を選ぶ ›」（× で端末に記憶）・日付の一覧の一番上に祝日の名前・7 日以内の予定に「天気」の行（同じ／片方なら 1 行、違えば 2 行）・マイページの「天気の地域」（都道府県 → 予報区。予報区が 1 つの県はその場で決まる。「設定しない」） |
| `apps/landing/privacy.html` | 1 節の行・3 節「天気と祝日について」（草案どおり） |
| `apps/app/lib/releases.ts` | 3.3.0「カレンダーに天気と祝日」 |

## テスト

| # | 何を | どこで | 結果 |
|---|---|---|---|
| T1 | 118 コード全部に主の絵。111 晴後曇 → sun+cloud、203 曇時々雨 → cloud+rain、雷を含む全コード → 副 thunder（主にはならない）、無いコード → cloud、霧・みぞれ | `packages/ui/test/weather-codes.test.ts` | 緑 |
| T2 | 固定の応答（東京都の写し）から東京地方の 7 日（09-17〜23）。短期の天気コードを優先、今日の気温は短期、他は週間。伊豆諸島北部は週間の「伊豆諸島」に倒れ気温は null。日が経てば残りだけ。5xx・形違い・タイムアウト → `days: []` で 200。office ごとに 1 時間キャッシュ（2 回目は fetch しない・TTL で取り直す） | `apps/api/test/weather.test.ts` | 緑 |
| T3 | `me.updateWeatherArea` は表に無いコード（office のコード・存在しない 6 桁・6 桁でない）を INVALID_INPUT で fetch しない。DB に直接入っていても fetch しない。URL は `JMA_FORECAST_URL + office + .json` と `HOLIDAYS_JP_URL` だけ。ヘッダは UA と accept だけ | 同上 | 緑 |
| T4 | `getForDate`: 同じ地域 → `same: true` で同じ day。片方未設定 → その側 null。違えば 2 つ。8 日先・昨日 → null | 同上 | 緑 |
| T5 | 同梱の表に今年・来年。外部が取れれば上書き（同梱にしか無い日は残る・他の年は返さない）、取れなければ同梱。1 日 1 回。形違いは無視。`holiday.list` はゲストも | 同上 | 緑 |
| T6 | 別ペアの相手の地域を返さない | 同上 | 緑 |
| T7 | 月表示: 絵（主 + 副）+ 最高気温、未設定なら帯 → マイページ／× で消えて記憶。祝日の赤（`eventAnniversary`）と一覧の名前。予定の詳細: 1 行／2 行／片方だけ／予定が無ければ出ない。マイページ: 都道府県 → 予報区・1 つの県はその場・「設定しない」 | `calendar-screen.test.tsx`・`profile-screen.test.tsx` | 緑 |
| T8 | `/privacy` に地域の行・「天気と祝日について」・気象庁・内閣府・送りません | `weather.test.ts` | 緑 |

`pnpm lint`・`pnpm type-check`・`pnpm test`（api 764・app 594・ui 20・date 67・db 32）すべて緑。`db:generate` 差分なし。

## 画面（`artifacts/058/stage1/`。390×844・両モード。`scripts/capture.mjs`。天気は本物の気象庁から）

| ファイル | 何 |
|---|---|
| `{pink,white}-calendar-no-area.png` | 未設定: 帯「天気の地域を選ぶ ›」 |
| `{pink,white}-profile-area-prefectures.png` `-tokyo.png` `-selected.png` | 都道府県 → 東京都の予報区 → 「東京地方 ›」 |
| `{pink,white}-calendar-month.png` | 17〜23 日に絵 + 最高気温。21・22・23 日が赤（敬老の日・休日・秋分の日） |
| `{pink,white}-calendar-day-weather.png` | 今日の予定の下に「東京地方: 雨後曇・最高 23° / 最低 19°」 |

## B が決めたこと

- **絵は仮**: `icons-source.png` がまだ無いので、`make-icons-placeholder.py` で 5 つを描いた（112×112・透過・役割の名前）。絵が来たら同じ名前で差し替える（`docs/sample/README.md` に記録）
- 月表示のマスを正方形（`aspectRatio: 1`）から `minHeight: 56` に（絵と気温が入らない）。絵は 20px
- 帯は無料枠の帯と同じ形（`surfaceTint` のピル）。予定の詳細の天気の行は予定があるときだけ（0節 #5「予定なら」）
- 週間の区域の倒し方（上の表）。`week_area.json` が指すコードが週間予報に無いことがある（130020 → 130020 だが実体は 130100）
- 利用者数の「今日」等は 057 のまま。予報の「今日」は JST（気象庁の `timeDefines` の日付部分）
- `me.updateWeatherArea` の `areaCode` は 6 桁の数字だけ契約で通し、表に無ければ INVALID_INPUT。DB に表に無いコードがあっても `loadDays` が二重に弾く

## 停止条件の確認

- 気象庁の JSON: 短期 3 日 + 週間 7 日で、今日から 7 日分の天気コードと気温（今日は短期、他は週間）が取れた（東京都。他の office も同じ形）
- fetch は wrangler dev から通った（UA は 040 と同じ）
- 予報区は 142（都道府県の 2 段で選べる。北海道は 16）

## A へ

- `security-requirements.md` の 2 つ目の口・`architecture.md` 4節・5節は A が直した内容と実装が一致している（`weather.get`・`getForDate`・`holiday.list`・`me.updateWeatherArea`・`couple.get.weatherArea`）。食い違いは無い
- 人間の絵が来たら、切り出しは別の小さな PR（`make-icons.py` を足す）

## 人間の手番

- `docs/sample/weather/icons-source.png` を置く（B が切り出す）
- デプロイ後、マイページで地域を選び、月表示と予定の詳細を見る
