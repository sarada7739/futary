# 011: カレンダーUI — テスト結果

実行日: 2026-08-30 / セッションB

## `pnpm type-check`

全ワークスペースで通過（exit 0）。

```
packages/contract type-check: Done
packages/db type-check: Done
packages/ui type-check: Done
apps/app type-check: Done
apps/api type-check: Done
```

## `pnpm lint`

`eslint .` エラーなし。

## `pnpm test`

```
packages/ui test:  Test Files  2 passed (2)
packages/ui test:       Tests  7 passed (7)
apps/app test:  Test Files  8 passed (8)
apps/app test:       Tests  55 passed (55)
apps/api test:  Test Files  12 passed (12)
apps/api test:       Tests  181 passed (181)
```

apps/api・packages/ui は本タスクでは無変更（既存の緑を維持）。増えたのは apps/app のみ
（010完了時点36件 → 55件。内訳は下記）。

## 内訳（新規/変更ファイル）

- `apps/app/lib/calendar.ts`（新規） — 月グリッド（日〜土）の日付計算
  - `todayJst` / `monthGridRange` / `buildMonthGrid` / `addMonths` / `monthLabel`
  - `apps/app/test/calendar.test.ts`（新規、11件）:
    - `todayJst` の JST 日跨ぎ（UTC 14:59:59 → 当日 / UTC 15:00:00 → 翌日）
    - `monthGridRange` を A の PR #84 の実測値4件（2026年12月35日・2027年1月42日・
      2026年2月28日・2028年2月35日）とそのまま突き合わせ
    - `buildMonthGrid` の要素数・`inMonth` フラグ（前月・翌月のセルが
      `inMonth: false` で含まれること）
    - `addMonths` の年またぎ（前進・後退）
- `apps/app/lib/event-kind.ts`（新規） — 種別ラベル・グリフ（●/■/▲）・色の対応表
- `packages/ui/src/tokens.ts`（変更） — `colors.eventAnniversary` /
  `eventPlan` / `eventMeetup` を追加。`docs/architecture.md` 7節にも反映
  （017の `colors.overlay` 追加と同じ形）
- `apps/app/components/month-grid.tsx`（新規） — 月グリッド本体。日付セルは
  幅 `100/7%` の `flex-wrap` で折り返し、28〜42日のどの月でも余分な行を作らない。
  マーカーは色＋グリフの両方で種別を示す
- `apps/app/components/event-form.tsx`（新規） — 登録・編集フォーム（モーダル）。
  種別に「記念日」を選ぶと `repeatYearly` が自動で `true` になる。編集時の削除は
  確認2段階（post-card.tsx の `DeleteMenu` と同じ形）
- `apps/app/app/calendar.tsx`（新規） — 画面本体。月ナビゲーション・凡例・
  グリッド・選択日のイベント一覧カードを配線。3状態
  （読み込み中はグリッドの骨格のみ・イベントゼロの月・通信エラー+再試行）を実装
- `apps/app/app/(tabs)/index.tsx`（変更） — ヘッダーに「📅 カレンダー」導線を追加
- `apps/app/app/_layout.tsx`（変更） — `calendar` ルートを認証必須スタックに登録
- `apps/app/test/calendar-screen.test.tsx`（新規、8件） — 画面結合テスト
  - 選択日（既定は今日）のイベントが一覧に出る
  - イベントゼロの月で「予定はまだありません」
  - 通信エラーで「カレンダーを読み込めませんでした」+ 再試行ボタン
    （既定のリトライ〈3回・指数バックオフ〉が尽きるのを待つため、この1件だけ
    タイムアウトを通常より長く取っている）
  - **グリッド先頭（前月側にはみ出す日）に立てたイベントが表示される**
    （タスクの確認観点「月の初日〜末日でしか取っていないと必ず空になる」の回帰）
  - 追加フォームから登録 → 選択日の一覧に反映される（完了条件のE2Eテスト）
  - 記念日を選ぶと `repeatYearly` が自動で `true` になる
  - **編集は射影日（`event.date`）ではなく登録日（`event.sourceDate`）を対象にする**
    （下記「設計メモ」参照。今年に射影表示されている記念日を編集して保存すると
    登録日そのものが動いてしまうのを防ぐ回帰）
  - 編集フォームの削除→確認で `event.delete` が呼ばれ、一覧から消える

## 設計メモ: 編集対象は `sourceDate`

`event.list` は繰り返し記念日を照会範囲が触れる年ごとに射影して返す
（010・architecture.md 5節）。今年の表示に出ている記念日でも、
実際にDBへ保存されている日付（`sourceDate`）は登録された年のままである。

編集フォームを開くとき、表示上の `date`（射影後）ではなく `sourceDate`
（登録日）を初期値にし、`event.update` にもそちらを送る。ここを `date` にすると、
**「今年のカレンダーで記念日を編集しただけなのに、記念日の登録日そのものが
今年へ動いてしまう」** という壊れ方になる。`sourceDate !== date` のとき
（＝射影された表示を編集しようとしているとき）はフォームに注記を出す。

## 認可

011は新しい oRPC 手続きを増やしていない（既存の `event.list`/`create`/`update`/
`delete` をそのままクライアントから呼ぶだけ）。`security-requirements.md` 3節の
5項目チェックリストに変化は無い（apps/api 無変更のため181件のまま）。

`security-requirements.md` 10節1（認証・招待・画像アップロード・認可ミドルウェアを
触ったタスク）には該当しないため、011単体でのsecurity-auditor監査は必須ではない
（006・008・010と同じ扱い）。M3の他タスク（012・013）と合わせてまとめて監査する。
