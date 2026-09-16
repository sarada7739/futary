# 058（PR #406）— R の判定

futary-R で 687fe0a を checkout して実行した（`.dev.vars` は CI と同じダミー）。ui 20・date 67・db 32・app 594・api 764 全部緑。`tsc --noEmit` 緑・`eslint .` 緑。CI pass。`pnpm generate`（drizzle-kit）は差分無し。`worklog.md` は追記のみ。触ったものは戻した。

**判定: 受け入れ。必須修正なし。**

## 2 つ目の口（security-requirements.md）を自分で確かめた

- fetch する URL は `JMA_FORECAST_URL + area.office + ".json"` と `HOLIDAYS_JP_URL` の 2 つだけ。`office` は**利用者の入力ではなく同梱の表**（`WEATHER_AREAS[areaCode].office`）から。`areaCode` は契約（6 桁の数字）→ `isWeatherAreaCode`（表）→ `areaRef`（名前が引ける）→ `loadDays`（表）の順に弾く
- **生成した表の中身を機械で見た**: 142 区域・`office` 58 種（全部 6 桁の数字）・`week` 全部 6 桁の数字・`amedas` 全部数字（null 無し）。URL に差し込める値に `/`・`.` は無い
- 応答は Zod（`forecastSchema`）で形を見て要る項目だけ取り出す。12 秒で打ち切り。失敗（非 2xx・例外・形違い）は `null` → `days: []`。office ごとに 1 時間（失敗は 10 分）キャッシュ
- ヘッダは UA（040 と同じ）と `accept` だけ。Cookie・利用者の情報は送らない
- 相手の地域は `couple_members WHERE couple_id = ?1` で自分のペアだけ。ゲストは東京地方で固定

## 壊して確かめたこと（`weather` + `couple` 45 本）

| 壊し方 | 赤 |
|---|---|
| `me.updateWeatherArea` で表に無いコードも受け付ける | 1 本（T3） |
| キャッシュしない | 1 本（T2） |
| 相手の地域を `couple_id` で切らない | 1 本（T6） |
| 8 日先も返す | 1 本（T4） |
| **`loadDays` の二重の弾きを外す** | **緑**（記録 1） |
| **気象庁への fetch に余計なヘッダを足す** | **緑**（記録 2） |
| 非 2xx で投げる | 緑（`fetchReport` の catch が拾って null。守りが効いている方の緑） |

## 読んで確かめたこと

- 0節 #2: `couple_members.weather_area TEXT`（NULL 可）。GPS・IP の推定は無い。0節 #12: ゲストは `130010`
- 0節 #5: `getForDate` は同じ地域なら 1 回だけ取って両方に同じ `day`。片方 null。範囲外は両方 null
- 0節 #7: `weather-codes.ts` 118 コード（T1: 全部に主。雷は副。無いコードは曇）
- 0節 #9: 同梱 2026〜2027（35 日）+ holidays-jp を 1 日 1 回。取れなければ同梱。同梱にしか無い日は残す
- 0節 #13: `privacy.html` の 1 節の行と 3 節「天気と祝日について」（T8）。0節 #14: 3.3.0
- `pink-calendar-month.png`: 17〜23 日に絵 + 最高気温、21〜23 日が赤、予定の下に「東京地方: 雨後曇・最高 23° / 最低 19°」。本物の気象庁の応答で撮っている

## 記録（判定に使わない）

1. T3「表に無いコードが DB に直接入っていても fetch しない」は `weather.get` 経由なので、`areaRef`（名前が引けない → `area: null`）で先に止まり、`loadDays` の二重の弾き（`WEATHER_AREAS[areaCode]` が無ければ `[]`）はテストが通っていない。`loadDays("999999", …)` を直接呼ぶ 1 本を足すと固定できる。任意
2. 「ヘッダは UA と accept だけ」の検査は `holiday.list` の fetch にだけある。気象庁の fetch にも同じ `expect(init.headers).toEqual(...)` を足すと固定できる。任意
3. 絵 5 つは仮（人間の `icons-source.png` 待ち。B の報告どおり）。差し替えは別の小さな PR
4. 月表示のマスが正方形から `minHeight: 56` に変わった（B の報告どおり。人間が実機で見る）

## 私が確かめていないこと

- 本番の Workers から `jma.go.jp`・`holidays-jp.github.io` への fetch（`wrangler dev` では通っている。停止条件は本番で分かる）
- 人間の手番（地域を選んで月表示と予定の詳細を見る）

## 追加コミット（記録 1・2）

- B が記録 1（`loadDays("999999")`・`loadDays("130000")` を直接呼んで fetch せず []）と記録 2（気象庁の fetch のヘッダも UA と accept だけ・`signal` あり）のテストを `weather.test.ts` に足した。受け入れのまま
