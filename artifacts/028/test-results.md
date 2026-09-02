# 028: リストにメモと設定者を足す — テスト結果

**訂正（2026-09-02）**: 本ファイルの「procedures側でINVALID_INPUTを明示的に
検証する」という実装は`fix/wish-input-validation`で取り消され、契約のZod
スキーマ（`.min()`/`.max()`）に戻した。理由はAが`conventions.md`5節に
規約化した「`INVALID_INPUT`はDBを読まないと分からないことだけに使う」
という線引き。このファイルは当時の記録として残す。詳細は
`docs/security-report.md`「028」の訂正・`docs/worklog.md`参照。

## 027からの仕様変更

タスク定義どおり、027の決定を2つ覆した。

| 027で決めたこと | 028 |
|---|---|
| `created_by`はレスポンスに出さない | `createdByName`を出す（`event.list`と同じ形。IDは引き続き出さない） |
| `note`を持たない | `note`を追加（0〜200文字、trim後） |
| 権限はペアで共有 | 変えない。「変わらない」ことをテストで固定した |

## データモデル・マイグレーション

`packages/db/src/schema/wish.ts`に`note TEXT NOT NULL DEFAULT ''`を追加。
`0017_wishes_note.sql`は`ALTER TABLE wishes ADD COLUMN note text DEFAULT ''
NOT NULL`の1文（`wishes`は子テーブルのため表の作り直しは起きない）。
`apps/api/test/migration-existing-rows.test.ts`に既存行（note列を持たない
状態）へ0017を当てるとnoteが空文字になることを確認するケースを追加した
（DROP COLUMNで0016時点の構造を再現→マイグレーション再適用という、
0011等の「表を作り直す」パターンより単純な形で済んだ）。

`schema-integrity.test.ts`は確認したが変更不要と判断した。同ファイルが
固定しているのはnamed CHECK制約とindex/triggerの実体のみで、`note`は
CHECK制約を持たない単純な列追加（`ALTER TABLE ADD COLUMN`）のため、
インデックス一覧・CHECK一覧のどちらにも影響しない（実行して確認済み。
既存のテストのまま緑）。

## 重要な発見: oRPCのZodバリデーション失敗は常にBAD_REQUESTになる

`wishCreateContract`/`wishUpdateContract`のZodスキーマに`.min()`/`.max()`を
書いても、oRPCの`validateInput`（`@orpc/server`のソースで確認）はスキーマ
バリデーション失敗時に**常に`ORPCError("BAD_REQUEST", ...)`を投げ**、契約の
`.errors()`で宣言した`INVALID_INPUT`にはマッピングしない。実際に一時的に
`.max(200)`を契約に残したままテストを書いたところ、`code: "BAD_REQUEST"`が
返り`INVALID_INPUT`を期待するテストが落ちた。

タスク定義が「noteがtrim後200文字を超えたらINVALID_INPUT」「titleは
変更後も1〜100文字」と明示的にエラーコードを指定していたため、契約の
Zodスキーマからは`.min()`/`.max()`を外し（`trim()`のみ残す）、
`apps/api/src/procedures/wish.ts`内で`assertValidTitle`/`assertValidNote`
という関数を新設し、ハンドラ内で明示的に検証して`throw
errors.INVALID_INPUT()`する形にした。これは027の`titleSchema`（Zodの
`.min(1).max(100)`のみ）も同じ問題を抱えていたことの発覚でもある
（027のテストは`.rejects.toThrow()`のみでコード不問だったため気づかれ
なかった）。既存の`post.ts`等のINVALID_INPUT使用箇所も全てハンドラ内の
明示的throwであり、Zodスキーマの`.max()`だけに依存している箇所は無い
ことを確認した。

## サーバ側（`apps/api/src/procedures/wish.ts`）

- **`wish.list`**: `user`をLEFT JOINして`createdByName`を解決（`event.list`・
  `post.list`と同じ形）
- **`wish.create`**: `note`を受け取る（省略時は空文字）。入力検証を
  上限判定（COUNT）より先に行う（security-auditor指摘。安く拒否できる
  ものを先に拒否する）
- **`wish.update`（新規）**: `{id, title?, note?}`。`COALESCE(?, column)`で
  渡されなかった項目を変えない。`created_by`はSET句に含めず更新しない。
  WHERE句に`couple_id`を含めた1文（027の`setDone`/`delete`と同じパターン）
- **`wish.setDone`**: レスポンスに`createdByName`を含めるようになったため
  `fetchUserName`で解決するよう変更

`apps/api/test/wish.test.ts`（新規23テスト・既存分を028仕様に更新）で
証明した項目:
- `wish.list`が`createdByName`を返し`created_by`を返さない
- 相手が入れたwishを、もう1人が編集・削除・チェックできる（現状維持の確認。
  タスク定義「確かめずに現状維持と書かない」への対応）
- `wish.update`で`created_by`（＝`createdByName`）が変わらない
- 他ペアのid・存在しないid・削除済みのidが`wish.update`でNOT_FOUND
- ゲストは`wish.update`を通れない（`authorization.test.ts`）
- title/noteの境界値（100/200文字ちょうどは通り、101/201文字はINVALID_INPUT）
- 渡さなかった項目が変わらない（titleだけ更新でnoteが残る、逆も）
- 既存行が空のnoteを持つ（マイグレーション）

## security-auditorの監査

**High以上はゼロ。**Low 4件、全て対応済み:
1. titleの境界値（101文字）テストが無かった → 追加（note側と対称にした）
2. `MAX_TITLE_LENGTH`という汎用名がevent.ts内のprivate定数と同名で衝突の
   懸念 → `MAX_WISH_TITLE_LENGTH`/`MAX_WISH_NOTE_LENGTH`にリネーム
3. `wish.create`が入力検証よりCOUNT問い合わせを先に行っていた → 順序を
   入れ替え、`wish.update`と揃えた
4. `security-requirements.md`6節の列挙（制御文字を正規化していない対象）に
   `wish.note`が入っていなかった → 追記

詳細は`artifacts/028/security-audit-raw.md`参照。

## クライアント側（`apps/app/app/(tabs)/list.tsx`）

- 各行に設定者の名前（`createdByName`）を小さく表示。編集可否とは無関係
  （タスク定義2節「押せる／押せないの差を名前の横に作らない」。ペアの
  誰でも編集・削除できるため、そもそも差が無い）
- メモを一覧にそのまま表示（折りたたまない）。無ければ何も表示しない
- 「編集」ボタンでインラインの編集フォーム（`WishEditForm`）を開く。
  タイトル・メモの両方を編集可能。モーダルにしない（027の方針を編集にも
  引き継いだ）
- ゲストには「編集」ボタンも出さない（他の操作と同じ導線）

`apps/app/test/list-screen.test.tsx`に設定者名表示・メモ表示（有無）・
編集フロー（保存・キャンセル・空タイトルで保存不可）のテストを追加。

`pnpm -w test`: apps/app 203件・apps/api 377件・packages/db 21件、全て緑。
`pnpm -r type-check`・`eslint .`、両方通過。

## デモシード（`packages/db/seed/demo.ts`）

既存の7件（未達成4件・達成済み3件、設定者2人に分配済み）にメモを追加。
メモ有り4件・無し3件の両方を含む。`demo.test.ts`にメモ有無の両方が
入っていることを確認するテストを追加。

## Bによるブラウザでの確認（未認証・デモ経路）

ローカルD1に0017を適用・デモ再投入後、`wrangler dev` + `expo start --web`
でBrowser paneから確認。

- ホームの「リスト」→デモの一覧で、各項目に設定者名（ゆい/れん）が正しく
  表示される
- メモがある項目にはメモがそのまま表示され、無い項目には何も出ない
  （折りたたみ無し）
- 達成済み項目にもチェック・設定者名・メモが正しく表示される
- デスクトップ幅・モバイル幅375×812の両方でレイアウト崩れなし
- ゲストでは「編集」ボタンが出ないことを確認（027の確認済みの
  チェック・削除の非表示に加えて）

**認証必須の経路（実際のタイトル・メモの編集操作、相手の編集を確認する
2アカウント操作）はB（自動化）では実機確認ができない**（027と同じ制約）。
`artifacts/028/manual-check.md`参照。
