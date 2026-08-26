# 010: カレンダーAPI

## 目的
記念日・予定・会った日を保存できるようにする。
「会った日」は統計カード（012）の「会った回数」の算出元にもなる。

## 変更対象ファイル
- （新規）`packages/db/schema/event.ts`
- （新規）`packages/db/migrations/xxxx_event.sql`
- （新規）`apps/api/src/procedures/event.ts`
- （新規）`apps/api/src/lib/date.ts` — JST の日付ユーティリティ
- `packages/contract/` — `event.list` / `event.create` / `event.update` / `event.delete`

## 実装内容
- スキーマは `docs/architecture.md` 4節に従う。`kind` は `anniversary` / `plan` / `meetup`（ADR-009）
- **日付は `YYYY-MM-DD` の文字列で保持する。** Unix秒で持つとタイムゾーンで必ず壊れる
- `apps/api/src/lib/date.ts` に JST 前提の日付関数をまとめる
  - 「今日（JST）」の取得
  - 日付文字列の差分（日数）
  - `n` ヶ月前 / `n` 年前 の日付文字列
  - **ここに全ての日付計算を集約する。** 各所で `new Date()` を直接使わない
- `event.list`: `from` / `to` の範囲で取得する
  - `repeat_yearly = true` の記念日は、**照会年に射影して返す**
    （2024-05-18 の記念日を 2026年5月の照会で返す）
  - うるう年の 02-29 の扱いを決めてコメントに残す（平年は 02-28 に寄せる等）
- `event.create` / `update` / `delete`: `writeProcedure` の上に載せる
  - 更新・削除は WHERE 句に `couple_id` を含めて1文で行う

## テストで証明すること
- `repeat_yearly` の記念日が、登録年と異なる年の照会で正しく返ること
- うるう年 02-29 の記念日が平年でも消えないこと
- 日付の差分計算が JST 基準で正しいこと（UTC との日跨ぎ時刻でテストする）

## 確認観点
- 日付計算が `lib/date.ts` に集約されているか（他所に `new Date()` が散っていないか）
- タイムゾーン関連のテストが実際に日跨ぎの時刻を検証しているか

## 完了条件
- [ ] 3種のイベントの作成・一覧・更新・削除が動く
- [ ] 繰り返し記念日が照会年に射影される
- [ ] 日付関連のテストが緑（うるう年・日跨ぎを含む）
- [ ] 005 の認可テストも緑
- [ ] `artifacts/010/` にテスト結果を保存

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション

## 進捗
- [ ] スキーマ + マイグレーション
- [ ] `lib/date.ts`（JST 集約）
- [ ] `event.list`（繰り返し射影）
- [ ] `event.create` / `update` / `delete`
- [ ] 日付テスト（うるう年・日跨ぎ）
- [ ] 証跡保存 → `state.md` 更新 → `worklog.md` 追記
