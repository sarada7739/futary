# 019: 記念日とプロフィールの設定 — テスト結果

実行日: 2026-08-30 / セッションB

## `pnpm type-check`

全ワークスペースで通過（exit 0）。

## `pnpm lint`

`eslint .` エラーなし。

## `pnpm test`

```
packages/ui test:  Test Files  2 passed (2)
packages/ui test:       Tests  7 passed (7)
packages/date test:  Test Files  1 passed (1)
packages/date test:       Tests  46 passed (46)
apps/app test:  Test Files  11 passed (11)
apps/app test:       Tests  81 passed (81)
apps/api test:  Test Files  15 passed (15)
apps/api test:       Tests  247 passed (247)
```

apps/apiは205件（018完了時点）→247件（+42。couple.test.ts +16・stats.test.ts +7・
authorization.test.ts +2・r2-signed-url.test.ts 新設5件・me.test.ts +9・
schema-integrity.test.ts 新設4件）。apps/appは69件→81件（+12。
profile-screen.test.tsx 新設9件・stats-card.test.tsx +3）。

## 事前調査: Better Authはログインのたびにuser.name/user.imageを上書きするか

タスク定義が「確認してから設計を決める」と明示していたため、実装前に
`better-auth@1.7.2`のソース（`oauth2/link-account.mjs`の`handleOAuthUserInfo`）
を確認した。

既存ユーザーの再ログイン時、`name`/`image`を上書きするかどうかは
`opts.overrideUserInfo`で分岐しており、これは
`provider.options?.overrideUserInfoOnSignIn`から来る
（`api/routes/callback.mjs`）。`apps/api/src/auth.ts`の`socialProviders.google`は
この`options.overrideUserInfoOnSignIn`を設定していないため未設定＝falsy。

**結論: 現在の設定では、再ログインのたびにuser.name/user.imageが上書きされる
ことはない。** そのため別列を新設せず、既存の`user.name`/`user.image`列を
`me.update`で直接書き換える設計にした。

## D1特有の制約: 親テーブルへのCHECK制約追加

`couples`は`couple_members`/`invites`/`invite_failures`/`events`/`posts`から
FOREIGN KEYで参照される親テーブル。drizzle-kitはCHECK制約の追加を
「新テーブルを作って差し替える」手順（`PRAGMA foreign_keys=OFF; ...;
DROP TABLE couples; ...`）で生成するが、**D1はこのPRAGMAを無視して常にFKを
強制するため、親テーブルのDROPが`FOREIGN KEY constraint failed`で実際に失敗
することを実測で確認した**（`packages/db/migrations/0009_couple_dates.sql`の
コミット前に一度、drizzle-kit生成のままのSQLをローカルD1に当てて再現）。

対応として、`primary_date`列（自列だけを参照するCHECK）は
`ALTER TABLE ADD COLUMN ... CHECK(...)`で素直に追加し、`married_date`との
2列にまたがる制約（`primary_date='married'ならmarried_dateが必須`・
`married_dateはanniversary_date以降`）はTRIGGER（`BEFORE INSERT`/
`BEFORE UPDATE`をそれぞれ2組・計4本）で表した。エラーメッセージに
「CHECK constraint failed」という文言を含めることで、既存の
`isConstraintViolation`（`/constraint failed/i`で判定）がそのまま使える
ことも確認済み。詳細は`packages/db/src/schema/couple.ts`のコメント、
`packages/db/migrations/0009_couple_dates.sql`参照。

**この制約はAが`architecture.md`4節に反映した**（PR #123。
`PRAGMA foreign_keys=OFF`の記述の隣に「子テーブルを持つ親テーブルには、
あとからCHECKを足せない」を追記）。あわせて「実体とファイルのずれを
1つのテストで固定する」（`sqlite_master`のindex/trigger一覧を期待値と
突き合わせる）という提案も受け、`apps/api/test/schema-integrity.test.ts`
として実装した。Rのレビューでも「TRIGGERを直接検証するテストが無い」
指摘を受け、Zodのrefineを経由しない直接INSERT/UPDATEのテストを
`couple.test.ts`に追加した。

## 内訳（新規/変更ファイル）

- `packages/db/src/schema/couple.ts`（変更） — `married_date`（NULL許容）・
  `primary_date`（既定'dating'）を追加
- `packages/db/migrations/0009_couple_dates.sql`（新規） — 上記の理由により
  drizzle-kit生成のSQLをALTER TABLE ADD COLUMN + TRIGGERへ手で書き換えた
- `packages/contract/src/couple.ts`（変更） — `marriedDate`/`primaryDate`を
  `coupleSchema`に追加。`coupleUpdateContract`の入力に
  「primaryDate='married'ならmarriedDate必須」「marriedDateはanniversaryDate
  以降」のrefineを追加
- `packages/contract/src/stats.ts`（変更） — `daysTogether`に`married`・
  `hidden`（daysを含まない）を追加
- `packages/contract/src/me.ts`（変更） — `meUpdateContract`（名前・
  アイコン変更）・`meUploadImageUrlContract`（署名付きPUT URL）を新設
- `apps/api/src/lib/r2-signed-url.ts`（変更） — `userImageKeyFor`（`users/...`
  前綴り。`couples/...`とは別）・`resolveUserImage`（外部URLかR2キーかを
  前綴りで判別し、後者だけ署名付きGET URLへ解決）を追加
- `apps/api/src/procedures/me.ts`（新規） — `me.update`（`UPDATE ... SET
  image = COALESCE(?, image)`でimageId省略時に既存画像を保持）・
  `me.uploadImageUrl`
- `apps/api/src/procedures/couple.ts`（変更） — `married_date`/`primary_date`
  を読み書き。DBのTRIGGER違反を`isConstraintViolation`で捕捉し`INVALID_INPUT`
- `apps/api/src/procedures/stats.ts`（変更） — `computeDaysTogether`が
  `primary_date`に従って`dating`/`dating_upcoming`/`married`/
  `married_upcoming`/`hidden`を出し分ける（Aの決定・PR #123で改名・追加）。
  メンバーの`image`も`resolveUserImage`で解決
- `apps/api/src/procedures/post.ts`（変更） — `authorImage`も
  `resolveUserImage`で解決（表示名の決め方を1箇所に集約する方針どおり）
- `apps/app/app/(tabs)/profile.tsx`（全面書き換え） — 名前・アイコン変更、
  付き合った日・結婚した日の設定、ホーム上部表示の3択
- `apps/app/components/stats-card.tsx`（変更） — `daysTogetherLabel`が
  5状態すべてに対応（hiddenは表示自体を出さない）
- `apps/api/test/schema-integrity.test.ts`（新規） — `sqlite_master`の
  index/trigger一覧を期待値と突き合わせるテスト（architecture.md 4節）

## 未確認事項

- カレンダー・マイページは認証必須のためB（自動化）は実機確認ができない。
  `artifacts/019/manual-check.md`参照
