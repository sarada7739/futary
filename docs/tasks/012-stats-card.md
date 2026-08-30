# 012: ペア統計カード

## 目的
ホーム画面の最上部に「付き合って○日目」「会った回数」を表示する。
デザイン上、この画面で一番目立つ要素であり、これが無いとホームが成立しない。

## 変更対象ファイル
- （新規）`apps/api/src/procedures/stats.ts` — `stats.get`
- （新規）`apps/app/components/stats-card.tsx`
- `apps/app/app/(tabs)/index.tsx` — 008 で空けた上部の枠を埋める
- `packages/contract/` — `stats.get`

## 実装内容
- `stats.get` は専用テーブルを持たず、既存テーブルから算出する（`docs/architecture.md` 4節）

| 指標 | 算出 |
|---|---|
| `daysTogether` | JSTの今日 − `couples.anniversary_date` + 1 |
| `meetupCount` | `events` の `kind = 'meetup'` の件数 |
| `postCount` | `posts` の未削除件数 |
| `photoCount` | `posts` の **未削除**かつ `image_key IS NOT NULL` の件数。**`AND deleted_at IS NULL` を忘れない**（論理削除した行は `image_key` を残すため、忘れると写真の枚数が投稿数を上回る） |

- 日付計算は **`packages/date`** を使う。**`new Date()` / `Date.now()` を直接書かない**（`architecture.md` 2節）
- `readProcedure` の上に載せる（デモでも見える）

### 未来の記念日を入力できるようにする

**人間が「あと◯日の方が親切」と決めた。**その決定を実装するには、
**`anniversaryDateSchema` の `value <= todayJst()` を外す必要がある。**

外さなければ未来の記念日を登録できず、**`upcoming` 側は永久に到達しない。**
到達しない分岐を作るのは、下で `Math.max(1, ...)` を退けたのと同じ形になる。
**表示だけ作って入力を塞いだままにしない。**

- 上限を置く。**1年後まで。**`1900-01-01` の下限と同じ性質の歯止めで、
  業務上の意味ではなく**打ち間違いを弾くためのもの**（`2126-05-18` 等）
- `couple.create` / `couple.update` の両方

### `daysTogether` に下限を持たせない

**`Math.max(1, ...)` を書かない。**負の値を出さない責任は、
判別可能な union（`together` / `upcoming`）がサーバ側で持つ。
**表示側で数値を丸めて隠さない。**

017 の当たり判定・`Screen` の `maxWidth` と同じ形で、
**呼び出し側に2本目の防御線を書かない。**

**判断の基準**: 到達不能な状態への備えを残すかどうかは、
**壊れたときにそれが見えるかどうか**で決める。
`authorName` の null 許容（L35）は代替表示が出るので**見える**から残した。
`Math.max(1, ...)` は正常な値に見えるので**見えない**から入れない。

**そして「到達不能だから作らない」と「到達可能にしてから作る」も別である。**
`upcoming` は後者。**入力を開けるので到達する。**
- カードのデザイン
  - 2人のアバターを並べ、間にハートを置く
  - 「付き合って **365** 日目」を大きく、「会った回数: 48回」を小さく
  - デザインサンプルのホーム画面を参考にする

## 境界条件（テストで押さえる）
| 条件 | 期待 |
|---|---|
| 記念日が今日 | 1日目 |
| 記念日が昨日 | 2日目 |
| 記念日が未来の日付 | **「あと○日」と出す**（人間の決定）。`daysTogether` は判別可能な union（`together` / `upcoming`）で返す。**入力スキーマの未来日禁止を外す**（下記） |
| 会った日ゼロ | 0回と表示。カードは出す |
| ペアが1人だけ | アバターの片方を「招待中」表示にする |

## テストで証明すること
- **`anniversaryDateSchema` が1年より先の日付を拒否すること**（打ち間違いの歯止め）
- **未来の記念日で `upcoming` が返り、`days` が正の値になること**
- **`photoCount` が削除済みの写真投稿を数えないこと**

## 確認観点
- 日数の off-by-one が無いか（記念日当日が「1日目」になるか）
- JST の日付境界で正しいか（UTC 15:00 を跨いだ時刻でテストされているか）
- ペアが1人の状態でカードが壊れないか

## 完了条件
- [x] ホーム最上部に統計カードが表示される
- [x] 上記の境界条件5件がテストで緑
- [x] 005 の認可テストも緑
- [ ] `artifacts/012/` に**人間の実機確認の記録**（操作した項目と結果。テキスト）を保存
  — **未達。認証必須画面のため人間の実機確認が必要（下記実装メモ参照）**

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション

## 進捗
- [x] `stats.get`
- [x] 統計カード UI
- [x] ホームへの組み込み
- [x] 境界条件テスト5件
- [x] 証跡保存 → `state.md` 更新 → `worklog.md` 追記

## 実装メモ

- `packages/contract/src/stats.ts`（新規）: `daysTogether`を判別可能なunion
  （`{status:"together",days}` / `{status:"upcoming",days}`）にした。負の値を
  出さない責任をサーバ側で閉じ、「両方null」「両方非null」という無効な状態を
  型で排除している（Rの助言・Aの支持）。`members`（`{userId,name,image}[]`）を
  追加し、カードのアバター表示・「ペアが1人だけ」の判定に使う
  （デザインサンプル`docs/sample/sample.png`のホーム画面を参照）
- `packages/contract/src/couple.ts`: `anniversaryDateSchema`の上限を
  「今日まで」から「1年後まで」（`yearsBefore(todayJst(), -1)`）に緩和
  （L66・Aの決定。`upcoming`側を実際に到達可能にするため）
- `packages/contract/src/event.ts`: `eventInputSchema`に
  `kind==='anniversary' || !repeatYearly`の`refine`を追加（L67・Aの決定）。
  `.extend()`と`.refine()`の順序上、共通の基底スキーマ
  （`eventInputBaseSchema`）を作り、`create`/`update`それぞれに同じrefine関数
  を適用する形にした
- `apps/api/src/procedures/stats.ts`（新規）: `computeDaysTogether`を
  エクスポートし、off-by-oneの境界（together側の下端＝今日／upcoming側の下端＝
  明日）を純粋関数として直接テストした（Rの指摘: 片側だけだと見逃す）。
  `photoCount`に`AND deleted_at IS NULL`を含めた（L65）。`members`は
  `couple_members LEFT JOIN user`をslot昇順で取得
- `apps/app/components/stats-card.tsx`（新規）: 通信エラー時はカード自体を
  出さない（ホーム画面の主役は投稿一覧のため、統計カードの失敗で画面全体を
  止めない）。読み込み中は同じレイアウトの骨格（灰色の円・「―」）を出す
- `apps/app/app/(tabs)/index.tsx`: ヘッダー内の「📅 カレンダー」ボタンの下に
  `StatsCard`を追加。既存の`home-timeline.test.tsx`が`stats.get`を新たに
  呼ぶようになったため、モックに既定値を追加して既存テストの回帰を防いだ
- テストは apps/api 176件（新規24件: stats 15・couple 3・event 6）・
  apps/app 56件（新規5件）・packages/contract は単体テスト基盤が無いため
  型チェックのみ。型チェック・lint通過
- 005の認可テストに`stats.get`を追加（NEEDS_ONBOARDING・デモペア読み取り）。
  基底経由チェックの実在数を16→17に更新

## 未確認（人間の実機確認が必要）

011・017と同じ制約（conventions.md 8節）。ホーム画面は認証必須のため、
B（自動化）はこの経路を通れない。以下は自動テストでは担保できていない:

1. 実機でカードのレイアウト（2人のアバター・ハート・大きい日数表示・小さい
   会った回数）がデザインサンプルに近い見た目になっているか
2. 実データで「あと○日」（未来の記念日）が実際に見え方として自然か
3. 「招待中」表示が実機で分かりやすいか
4. JSTの日付境界（UTC 15:00前後）で実機の表示が正しく切り替わるか
   （`computeDaysTogether`自体はテスト済みだが、実際の日付が変わる瞬間の
   キャッシュ更新タイミングは未確認）

`docs/state.md`に論点として起票する。
