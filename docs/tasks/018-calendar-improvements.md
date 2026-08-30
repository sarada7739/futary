# 018: カレンダーの改善（設定者・時間・会った日の一意化）

## 目的
M3 の受け入れ確認で人間から出た3件の要望に応える。

1. **予定に設定者の名前が出ない。**誰の予定か分からない
2. **時間を設定できない。**任意で入れたい
3. **「会った日」が1日に何個でも作れる。**二人で1日1つにしたい。後から設定したもので上書き

**実際に触って出てきた要望なので、計画の後ろに回さない**（017 と同じ扱い）。

## なぜ 014 の前に置くか

**`events` のスキーマが変わる。**014 はデモのシードで `events` に20件ほど投入する。
スキーマが後から変われば**シードを書き直すことになる。**

3 の一意化も同じで、**シードが1日に複数の `meetup` を入れてしまうと、
あとから制約を張れなくなる。**

## 変更対象ファイル
- `packages/db/src/schema/event.ts` — `time` 列、`meetup` の部分 UNIQUE
- （新規）`packages/db/migrations/xxxx_event_time_and_meetup_unique.sql`
- `packages/contract/src/event.ts` — 入出力スキーマ
- `apps/api/src/procedures/event.ts` — JOIN、upsert
- `apps/app/app/(tabs)/calendar.tsx` ほかカレンダーの UI

---

## 1. 設定者の名前を返す

**`post.list` の `authorName` と同じ形にする**（`architecture.md` 5節）。
**同じ問題に2つの解を持たせない。**

- `events.created_by` は既にある。**新しいデータは要らない**
- `user` への **LEFT JOIN** で `createdByName` を返す
- **null 許容にする。**`created_by` は `user(id)` への外部キーを
  `ON DELETE no action` で持つので現状は到達しないが、
  `ON DELETE` が変われば INNER JOIN は**予定を黙って消す**（L35 と同じ判断）
- **画像は返さない。**人間が求めたのは名前だけである。**先回りして足さない**

UI は予定に設定者の名前を添える。**どちらが作ったか分かればよい。**

## 2. 時間を任意で設定できるようにする

### 保存の形

**`time TEXT` を追加する。`HH:MM` の24時間表記、NULL 許容。**

`date` を `YYYY-MM-DD` の文字列で持つのと同じ理由である
（`architecture.md` 4節）。**JST の壁時計としての時刻**であって、
ある瞬間ではない。Unix 秒で持つとタイムゾーンで壊れる。

入力の検証は `^([01]\d|2[0-3]):[0-5]\d$`。

### `anniversary` には時間を設定できない

**入力スキーマで拒否する**（`kind === "anniversary"` かつ `time` が非 NULL なら
`INVALID_INPUT`）。`repeatYearly` を `anniversary` に限ったのと同じ形である
（`architecture.md` 5節）。

記念日は**「日」であって時刻を持つ概念ではない。**
毎年射影される性質とも噛み合わない（「毎年 5/18 14:30」は意味を成さない）。

「記念日の日に予定がある」なら、それは `plan` である。

### 表示

- 時間があれば時間を添える。無ければ日付だけ
- **時間の有無で行の高さが変わらないようにする。**同じ日に両方が並ぶため

## 3. 「会った日」を1日1つにする

### 宣言的制約にする。数えて判断しない

**部分 UNIQUE インデックスを張る。**

```sql
CREATE UNIQUE INDEX events_meetup_unique
  ON events (couple_id, date) WHERE kind = 'meetup';
```

`posts.image_key` の UNIQUE、`events.kind` の CHECK と同じ方針である。
**アプリケーション側で数えて判断しない。**

**「SELECT で確認してから INSERT/UPDATE」の2段階にしない**
（`security-requirements.md` 3節）。**D1 にインタラクティブなトランザクションが無い**
以上、2段階は途中で割り込まれる（`architecture.md` 4節）。

### 上書きは `ON CONFLICT DO UPDATE` で行う

人間の要望は「**後に設定したものが上書きされる**」である。エラーではない。

`event.create` は `kind = 'meetup'` のとき
`INSERT ... ON CONFLICT (couple_id, date) WHERE kind = 'meetup' DO UPDATE SET ...`
とする。**1文で済み、原子性が保たれる。**

- **この構文が D1 で通ることを、実装前に小さく確かめること。**
  部分インデックスを衝突対象にするには `WHERE` 句まで一致させる必要がある。
  通らなければ報告してほしい。設計を変える

### `event.update` は衝突したらエラーにする

**上書きしない。**`INVALID_INPUT` で「その日には既に会った日がある」と返す。

`create` は「この日は会った日だ」という宣言なので上書きが自然だが、
`update` は**特定の1件を編集する**操作である。
**別の行が黙って消えるのは、利用者の意図と違う。**

### 既存の重複データ

マイグレーションで**先に重複を潰してから**インデックスを張る。

**残すのは最新の1件**（`created_at` が最大、同値なら `id` が大きい方）。
新しい挙動（後のもので上書き）と揃える。

`meetupCount`（012）は行数を数えているので、**この変更で「会った日数」になる。**
統計の意味としてはむしろ正しくなる。**要件の文言と食い違わないか確認すること。**

---

## テストで証明すること
- `event.list` が `createdByName` を返し、**`user` 行が無くても予定が落ちない**
- `anniversary` に `time` を付けると `INVALID_INPUT` になる
- `plan` / `meetup` には `time` を付けられる。NULL でも作れる
- **同じ日に2件目の `meetup` を `create` すると、1件目が上書きされて1件のままである**
- 別の日の `meetup` は影響を受けない
- **`event.update` で既に `meetup` がある日へ移そうとすると `INVALID_INPUT` になる**
- **マイグレーションが既存の重複を潰し、最新の1件を残す**
- 006 の認可テストが緑（`security-requirements.md` 3節。件数と内容は出典側を見る）

## 確認観点
- 時間の有無で行の高さが変わっていないか
- 「会った日」を同じ日に2回登録したとき、**上書きされたことが利用者に分かるか**
- 設定者の名前が、どちらの予定か判別できる形で出ているか

## 完了条件
- [ ] 予定に設定者の名前が出る
- [ ] 時間を任意で設定でき、`anniversary` では設定できない
- [ ] 「会った日」が1日1件に保たれ、後から設定したもので上書きされる
- [ ] 上記のテストが緑
- [ ] `artifacts/018/` に**人間の実機確認の記録**を保存

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション

## 進捗
- [ ] スキーマ + マイグレーション（`time`・部分 UNIQUE・重複の解消）
- [ ] 契約の変更（`createdByName`・`time`）
- [ ] `event.create` の upsert / `event.update` の衝突エラー
- [ ] カレンダー UI
- [ ] テスト
- [ ] 証跡保存 → `state.md` 更新 → `worklog.md` 追記
