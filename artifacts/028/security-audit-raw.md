# 028 リストにメモと設定者を足す — security-auditor 生ログ

監査を完了しました。読んだファイルは以下です。

- `C:\Users\coco7\futary\apps\api\src\procedures\wish.ts`
- `C:\Users\coco7\futary\packages\contract\src\wish.ts`
- `C:\Users\coco7\futary\packages\db\src\schema\wish.ts`
- `C:\Users\coco7\futary\packages\db\migrations\0017_wishes_note.sql`
- `C:\Users\coco7\futary\apps\app\app\(tabs)\list.tsx`
- `C:\Users\coco7\futary\apps\api\src\procedures\base.ts` / `middleware\auth-context.ts` / `index.ts` / `lib\error-id.ts` / `implementer.ts`
- `C:\Users\coco7\futary\apps\api\test\wish.test.ts` / `authorization.test.ts` / `migration-existing-rows.test.ts`
- `C:\Users\coco7\futary\packages\db\seed\demo.ts`
- `C:\Users\coco7\futary\apps\api\src\procedures\me.ts`（wishes の削除順）、`event.ts`（先例の照合）
- `node_modules/.pnpm/@orpc+server@1.15.0.../dist/shared/server.DEBcqOjg.mjs`（`validateInput` の実装）

以下、報告です。

---

### [2026-09-02] 監査対象: 028「リストにメモと設定者を足す」（`wish.*` 手続き・`note` 列・`createdByName`）

**High 以上の指摘は無い。**Critical / High いずれも 0 件。以下は Low 4 件のみ。

| 重大度 | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| Low | `apps/api/test/wish.test.ts`（`title` 上限のテストが存在しない。`grep` で `repeat(` は 103行・243行の `note` の201文字のみ） | `title` の上限100文字は 027 では契約の Zod `.max()` が宣言的に保証していたが、028 で `packages/contract/src/wish.ts:11` から外れ、保証は `apps/api/src/procedures/wish.ts:17` の手書き1行だけになった。その1行に回帰テストが無い（`note` の201文字は create/update 両方にあるのに `title` の101文字は片方も無い）。タスク定義 `docs/tasks/028-wish-note-and-author.md:81` は「変更後も 1〜100 文字」を要求している。DB にも CHECK は無く（`packages/db/src/schema/wish.ts:17`）、`wishSchema` の出力側にも長さは無いため、この1行が消えれば何も止めない。現時点では実装されており脆弱ではないので Low | `wish.create` / `wish.update` に「101文字の `title` は `INVALID_INPUT`」のケースを足し、`note` と対称にする。`assertValidTitle` / `assertValidNote` の境界値（100 / 200 ちょうどは通る）も併せて固定する |
| Low | `packages/contract/src/wish.ts:9` と `packages/contract/src/index.ts:33`、対比: `packages/contract/src/event.ts:21`、`apps/app/components/event-form.tsx:12` | wish 専用の値（100）が `MAX_TITLE_LENGTH` という汎用名でパッケージのトップレベルから export されている。一方 `event.ts:21` には同名の private 定数 `MAX_TITLE_LENGTH = 200` があり、画面側 `event-form.tsx:12` はさらに 200 を再定義している。同名で意味の違う定数が3箇所にあるため、将来 event 系のコードが `@futary/contract` から `MAX_TITLE_LENGTH` を import すると、型エラーもテスト失敗も出ないまま上限が静かに 100 になる。直接の脆弱性ではなく、上の1件（唯一の保証が手書き定数1つに集約された）と組み合わさると効く | export 名を `MAX_WISH_TITLE_LENGTH` / `MAX_WISH_NOTE_LENGTH` に変える。または event 側の 200 も同じ場所に集約し、名前で対象を区別する |
| Low | `apps/api/src/procedures/wish.ts:89-97` | `wish.create` は入力検証（96-97行の `assertValidTitle` / `assertValidNote`）より **先に** 上限判定の COUNT クエリ（89-92行）を D1 へ投げる。契約から `.max()` が外れたことで、長さが不正な入力は Zod でも止まらなくなったため、不正な入力1件につき必ず D1 クエリが1回走る形になった。認証必須（`writeProcedure`）でありペアの2人しか到達しないため実害は小さい。`wish.update` は検証が先（125-126行）で順序が逆になっている点も非対称 | 検証を COUNT より前へ移す。安く拒否できるものを先に拒否する（`wish.update` と順序を揃える） |
| Low | `docs/security-requirements.md:203-217`（6節「制御文字・双方向制御文字は正規化していない」） | 027 で明文化された「trim と長さしか見ていない」対象の列挙が `wish.title`・`post.body`・`event.title` のままで、028 で増えた `wish.note` が入っていない。実装上は同じ扱い（`wish.ts:19-21` は長さのみ）で方針変更は不要だが、この文書は「防いでいないと書いてあるのと、書いていないのは別である」（34行目）を明示的な原則にしている。列挙が実装に追いつかないと、次に読む人が「`note` は意図して外したのか、忘れたのか」を判別できない | 6節の列挙に `wish.note` を追記する。列挙を維持し続けるのが難しいなら、個別列挙をやめて「利用者が書ける自由記述の全て」という書き方にする |

#### 依頼された観点への回答

1. **認可・スコープ漏れ: 指摘なし。**
   - `wish.update` の引数は `{id, title?, note?}` で `coupleId` を受け取っていない（`packages/contract/src/wish.ts:55`）。`coupleId` は `context` からのみ取る（`wish.ts:123`）。
   - `UPDATE ... WHERE id = ?3 AND couple_id = ?4 AND deleted_at IS NULL ... RETURNING`（`wish.ts:130-136`）の1文で、SELECT で確認してから UPDATE という2段階になっていない。`security-requirements.md` 3節の要求どおり。
   - 5手続き全てのクエリに `couple_id = ctx.coupleId` があることを確認した（64・90・108・132・157・178行）。唯一 `couple_id` を含まないのは `fetchUserName`（54行）だが、引数は既にスコープ済みの行から出た `created_by` であり入力由来ではない。
   - デモ経路は `writeProcedure` が `readonly` を `FORBIDDEN` で弾き（`base.ts:74`）、`authorization.test.ts:259-269` が `wish.update` について固定している。`wish.list` の未認証読み取りはデモペアのみ（`authorization.test.ts:372-388`）。
   - **検証とスコープ判定の順序が安全側になっている。**`wish.update` は検証（125-126行）→ スコープ付き UPDATE（128行）の順なので、他ペアの id に不正な入力を添えても `INVALID_INPUT` が id の存在に依らず返る。行の存在を判別するオラクルにならない。

2. **バリデーションの手書き化: 実装ミスは無い。**
   - `@orpc/server@1.15.0` の `validateInput`（`server.DEBcqOjg.mjs:152-177`）が `throw new ORPCError("BAD_REQUEST", ...)` を固定で投げることを実際に読んで確認した。コメントの主張は正しい。
   - 検証漏れは無い。`create` は `title` と `note`（`?? ""` で正規化後）の両方を検証（96-97行）、`update` は `undefined` でない項目だけを検証（125-126行）。`undefined` はそのまま `COALESCE` で無変更になるので、検証をスキップして良い経路だけがスキップされている。
   - 空文字の扱いも正しい。`note: ""` は `?? null` に落ちず `COALESCE(?2, note)` が空文字を書き込むためメモを消せる（テスト213-225行が固定）。`title: ""` は Zod の trim を通ったあと `assertValidTitle` の `length < 1` で弾かれる（テスト227-235行）。`title: null` を送っても Zod の型で `BAD_REQUEST` となり `COALESCE` に `null` が届く経路は無い。
   - `errors: { INVALID_INPUT: () => unknown }` という構造的な型は、`INVALID_INPUT` を宣言していない契約に対して呼ぶとコンパイルエラーになるため、宣言漏れのまま実行時 `undefined` を呼ぶ形にはならない。両契約とも `INVALID_INPUT` を宣言済み（`contract/src/wish.ts:46, 61`）。
   - 残る懸念は上表 Low の1件目（`title` 上限にテストが無い）だけ。

3. **`created_by` が更新されないこと: 確認済み。指摘なし。**
   - `wish.ts:130-135` の `SET` 句は `title` と `note` だけで、`created_by` は `RETURNING` の読み出しにしか現れない。`wish.setDone`（155-159行）も同様。`created_by` に書き込むのは `INSERT`（108-110行）1箇所で、値は `context` の `userId`（`resolveCoupleContext` がセッションから決めた値）である。入力から `created_by` に到達する経路は無い。
   - SQL インジェクションの経路も無い。5手続き全てが `.prepare()` + `.bind()` のプレースホルダで、SQL 文字列に入力を連結している箇所は1つも無い。文字列連結で SQL を組むのは `packages/db/seed/demo.ts:438-443` のデモシードだけで、値は開発者が書いた定数、かつ `escapeSql`（46-48行）で `'` を `''` にしている。
   - テスト `wish.test.ts:248-263` は `RETURNING created_by` 経由で解決した名前を検証しているため、レスポンスの見た目だけでなく DB の値が変わっていないことを確かめている。

4. **`createdByName` の解決: 漏洩経路なし。**
   - `wish.list` の `LEFT JOIN user ON user.id = wishes.created_by`（72行）は、結合の相手を `WHERE wishes.couple_id = ?1` で絞られた行の列に限っている。結合条件に入力は入らない。
   - `fetchUserName`（53-56行）も同様に、引数はスコープ済みの行の `created_by`。`event.ts:68` と同一の先例に沿っている。
   - **`created_by` はレスポンスに出ていない。**`toWish`（38-47行）が6フィールドを明示的に組み立てており、`{ ...row }` に含まれる `created_by` は落ちる。加えて `.output(wishSchema)` の出力検証（`server.DEBcqOjg.mjs:178` の `validateOutput`）で未知キーが剥がれるため二重に守られている。`wish.test.ts:79-88` が `toEqual` の完全一致でこれを固定している。
   - デモ経路で出るのはシードの架空ユーザー名（`seed/demo.ts` の `DEMO_USER_WOMAN_ID` / `DEMO_USER_MAN_ID`）のみで、実在の人物には結びつかない。

5. **その他の確認（いずれも指摘なし）**
   - `me.delete` は `DELETE FROM wishes WHERE couple_id = ?1` をペア削除の batch に含んでいる（`me.ts:173`）ため、`created_by` の `user(id)` 参照が退会時に FK 違反を起こす経路は無い。ペアごと消えるので孤児の `created_by` も残らない。
   - T9（クライアントキャッシュ）: `list.tsx:203` の `queryKey` に `viewerKey` が入っており、`invalidate`（205行）は前方一致で届く。`wish.update` は mutation なのでキャッシュキーの対象外。
   - エラー処理: `withErrorId`（`lib/error-id.ts`）が想定外例外を ID のみに詰め替える。`wish.ts` に `console.*` は無く、メモ本文がログへ出る経路は見当たらない。`validateInput` が返す `data.issues` にはパスとメッセージのみが載り、入力値そのものは `cause` 側（クライアントへ直列化されない）に留まる。
   - 表示: `note` / `createdByName` はどちらも React Native の `Text`（`list.tsx:170-188`）でレンダリングされ、`dangerouslySetInnerHTML` は使っていない。
   - マイグレーション `0017` は `ALTER TABLE ADD COLUMN` 1文で表の作り直しを伴わず、既存行が空文字を得ることを `migration-existing-rows.test.ts:318-357` が実際に列を落として再適用する形で確認している。

---

## Bの対応（Low 4件、全て対応済み）

1. `apps/api/test/wish.test.ts`にtitleの境界値テスト（100文字ちょうどは通る・
   101文字はINVALID_INPUT）を追加。noteの200文字ちょうどの境界値テストも
   併せて追加した（create・update両方）
2. `MAX_TITLE_LENGTH`/`MAX_NOTE_LENGTH`を`MAX_WISH_TITLE_LENGTH`/
   `MAX_WISH_NOTE_LENGTH`にリネームし、event.ts側の同名private定数との
   衝突懸念を解消した
3. `wish.create`の検証（assertValidTitle/assertValidNote）を、COUNT問い合わせ
   より前に実行するよう順序を入れ替え、`wish.update`と揃えた
4. `docs/security-requirements.md`6節の列挙に`wish.note`を追記した

対応後、`pnpm -w test`（apps/app 203件・apps/api 377件・packages/db 21件）・
型チェック・lint全て緑を確認済み。
