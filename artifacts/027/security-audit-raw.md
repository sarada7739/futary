# 027 行きたい場所・食べたいものリスト — security-auditor 生ログ

## 初回監査（2026-09-01）

### [2026-09-01] 監査対象: タスク027「行きたい場所・食べたいものリスト」（`wish.*`）

| 重大度 | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| **High** | `apps/api/src/procedures/me.ts:160-173`（+ `packages/db/migrations/0016_wishes.sql:9`） | **`me.delete` が `wishes` を消さないため、wish を1件でも持つペアはアカウント削除が恒久的に失敗する。** `wishes.couple_id` は `couples(id)` を `ON DELETE no action` で参照しており（0016:9）、D1 は FK を常に強制する（`docs/architecture.md:346,805`。`PRAGMA foreign_keys=OFF` は無視される）。batch 内の `DELETE FROM couples WHERE id = ?1`（me.ts:168）が FK 違反で落ち、`db.batch()` は全文ロールバックする（me.ts:104-105 のコメント自身がこの壊れ方を記述している）。さらに **R2 の削除は batch より前に実行済み**（me.ts:155-158）のため、再実行しても毎回同じ地点で失敗し、**投稿画像とプロフィール画像だけが消え、投稿本文・記念日・wish の本文は D1 に残り続ける。** 論理削除済みの wish 行も対象になるため、「消したから大丈夫」は成り立たない | batch に `DELETE FROM wishes WHERE couple_id = ?1` を **`DELETE FROM couples` より前**（`invites` の隣が自然）へ追加する。あわせて `apps/api/test/me.test.ts:300-349` の削除テストに wish の作成を1件足し、`me.delete` 後に `wishes` の行が消えることを固定する（現在のテストは wish を作らないため、この不具合を1件も検知できない）。`coupleId` が引けない分岐（me.ts:189-194）では `wishes.created_by → user.id` の FK により最終行 `DELETE FROM user`（me.ts:202）も落ちうる点を確認すること（`posts.author_id` に同じ性質が既にあり、こちらは027起因ではない） |
| Medium | `apps/api/src/procedures/me.ts:160-173` / `packages/db/seed/demo.ts:363-365` | **`couple_id` を持つ表が増えたときに `me.delete` の漏れを検知する仕組みが無い。** デモシード側には「表が増えたときはここへ足す（027でwishesを追加）」という注記があり実際に追加されている（demo.ts:364-372）のに、`me.delete` 側には同種の注記も機械的な番人も無く、027 で片方だけ漏れた。`docs/tasks/024-account-deletion.md` にも「新しい表を足したらここに足す」という規則が存在しない。上の High は結果であって、これが原因である | `couple_id` 列を持つ表を `sqlite_master`（または drizzle スキーマ）から列挙し、`me.delete` 実行後にその全表でペアの行が0件になることを確認するテストを置く（`apps/api/test/schema-integrity.test.ts` や `authorization.test.ts:880`「許可リストに無い手続きは3基底のいずれかを経由している」と同じ、一覧を手で維持しない形）。手で並べた一覧を足すだけでは、次の表でまた同じ漏れ方をする |
| Low | `apps/api/src/procedures/wish.ts:51` / `apps/api/test/wish.test.ts:302-319` | **200件上限は「行数の上限」ではない。** COUNT が `deleted_at IS NULL` で絞るため、認証済みメンバーは create → delete（論理削除）を繰り返して `wishes` の行を無制限に増やせる。1リクエスト1行・最大100文字で、ペア境界は越えないため影響は D1 のストレージ消費のみ。`posts` にはそもそも上限が無く、この API に汎用のレート制限も存在しないため、027 が新たに作ったリスクではない。ただし「200件上限がある」という記述が行数の上限だと読まれうる | 対処不要と判断してよい。判断するなら「上限は一覧の表示件数を守るためのものであり、行数の上限ではない」と `docs/tasks/027-wish-list.md` 5節に1行書き足す。孤児行の回収が必要になったら、論理削除から一定期間後に物理削除するジョブで扱う |
| Low | `packages/contract/src/wish.ts:7` | `titleSchema` は trim と1〜100文字だけを見ており、改行・制御文字・双方向制御文字（U+202E 等）を通す。React Native の `Text` は既定でエスケープされ、`dangerouslySetInnerHTML` も使っていないため注入にはならないが、Web ビルドで表示する場合に見た目の偽装が起きうる。`post.body` も同じ性質のため 027 固有ではない | 対処は任意。行うなら制御文字を落とす正規化を `post.body` と共通の関数として置く（wish だけに入れると規則が2系統に割れる） |
| Low | `apps/app/app/(tabs)/list.tsx:163` | 「追加」ボタンに `createWish.isPending` による二重発火防止が無い。`compose.tsx:31`・`calendar.tsx:104`・`join.tsx:59`・`invite.tsx:97` など他の書き込み画面はすべて `isPending` で塞いでおり、ここだけ規則から外れている。`wish.setDone`/`wish.delete` は冪等なので実害は無いが、`create` は冪等でないため二重登録が起こる。`docs/tasks/027-wish-list.md` 3節「画面側の二重発火防止もやる」に対する逸脱でもある | `disabled={!canSubmit || createWish.isPending}` にする |

### 監査済み・指摘なしの範囲（根拠）

- **水平権限昇格（T1）**: 4手続きすべてが `readProcedure`/`writeProcedure` を経由し（`wish.ts:27,47,73,93`）、`authorization.test.ts:880` の走査対象に入っている。契約の入力に `coupleId` は無く（`packages/contract/src/wish.ts:31,42,52`）、SQL は4本とも `couple_id = ?` を含む（`wish.ts:34,51,80,99`）。`setDone`/`delete` は SELECT で確認してから UPDATE する2段階ではなく、WHERE 句に `couple_id` を含めた1文で、他ペア・不存在・削除済みを区別せず `NOT_FOUND` に畳んでいる（存在を教えない）。`security-requirements.md` 3節の要件1・7は維持されている。
- **デモ経路（T4/T5）**: 書き込み3手続きが `DEMO_COUPLE_ID` 設定下でも `FORBIDDEN` になることをテストが固定している（`authorization.test.ts:239-265`）。`wish.list` はデモペアの行のみを返す（同:360-377）。デモシードは決定的で実在の店名を含まない（`packages/db/seed/demo.ts:321-336`）。
- **T9（キャッシュ残留）**: `wish.list` は `implementer.wish.list.use(readProcedure)` の形をしているため `apps/app/test/viewer-key-coverage.test.ts:78` の走査に自動的に入り、`apps/app/app/(tabs)/list.tsx:86-88` が `viewerKey` を queryKey に含めている。無効化（同:90）は前置一致なので機能する。
- **COUNT→INSERT の非トランザクション設計**: **脆弱性ではないと判断する。** 上限を超えるには既にそのペアのメンバーである必要があり、超過量は同時実行中のリクエスト数で頭打ちになる。権限境界を越えず、`wish.list` の応答も壊れない。実質的な上限回避は競合ではなく上記 Low の論理削除経路であり、そちらも影響はストレージに限られる。
- **入力検証**: `z.string().trim().min(1).max(100)` は trim 後に長さを見る順序になっており（`packages/contract/src/wish.ts:7`）、サーバ側で強制される。SQL はすべてプレースホルダ束縛で、文字列連結は無い。`id` は `crypto.randomUUID()`（`wish.ts:56`）で暗号論的乱数。
- **エラー処理**: 返すのは `NOT_FOUND`/`LIMIT_REACHED`/`FORBIDDEN`/`NEEDS_ONBOARDING` のみで、SQL・内部パス・スタックトレースを含まない。本文をログに出す箇所も無い。
- 画像・招待コードは 027 で触れていないため対象外とした。`pnpm audit` / gitleaks の出力は今回渡されていないため、その観点は評価していない。

**High 以上の指摘: 1件あり**（`me.delete` の `wishes` 削除漏れ）。`docs/tasks/027-wish-list.md` の完了条件「`security-auditor` の監査で High 以上がゼロ」は現時点では満たされていない。

なお `docs/tasks/027-wish-list.md:90-91` の「新規テーブルであり、他表から FK 参照されない。`architecture.md` 4節の問題は起きない」という記述は、**参照される側**の話としては正しいが、**`wishes` が `couples`・`user` を参照する側になったこと**の帰結（削除順序）を見落としている。B はこの記述を根拠に安全と読める状態にあったため、実装だけでなくこの1行も訂正の対象に含めることを勧める。

主要な参照ファイル:
- `C:\Users\coco7\futary\apps\api\src\procedures\me.ts`
- `C:\Users\coco7\futary\apps\api\src\procedures\wish.ts`
- `C:\Users\coco7\futary\packages\db\migrations\0016_wishes.sql`
- `C:\Users\coco7\futary\packages\db\seed\demo.ts`
- `C:\Users\coco7\futary\apps\api\test\me.test.ts`
- `C:\Users\coco7\futary\apps\app\app\(tabs)\list.tsx`
- `C:\Users\coco7\futary\packages\contract\src\wish.ts`

---

## 再監査（2026-09-01・High修正後）

再監査しました。Highは解消しています。

### [2026-09-01] 再監査対象: 027 High指摘の修正（`me.delete` の `wishes` 削除漏れ）

| 重大度 | 箇所 | 内容 | 判定 |
|---|---|---|---|
| ~~High~~ → **解消** | `apps/api/src/procedures/me.ts:173` | `DELETE FROM wishes WHERE couple_id = ?1` が `db.batch()` 内の `DELETE FROM events`（:167）と `DELETE FROM invites`（:174）の間に入り、`DELETE FROM couples`（:176）より前にある。`wishes.couple_id` の FK 違反が起きる順序ではなくなった。論理削除済みの行も `couple_id` だけで絞るため取り残されない。冒頭の順序コメント（:90-98）も1〜7に更新済みで、実装とコメントがずれていない | **解消を確認** |
| ~~Medium~~ → **解消** | `apps/api/test/me.test.ts:452-488` | `couple_id` 列を持つ表を `sqlite_master` から機械的に検出し、`me.delete` 後に全表で0件を確認する番人が入った。`expect(coupleIdTables).toEqual(expect.arrayContaining([...]))`（:477-479）で検出ロジックが0件に退化したときも落ちる形になっており、`authorization.test.ts:880` の走査と同じ「手で維持する一覧に頼らない」形を満たしている | **解消を確認** |

補足として、既存テストへの追加（:325 の wish 作成 + :339 のアサーション、:374 の手動DELETE列、:405 の `wishes削除後で止める` ケース）も確認しました。とくに :325-339 は、**修正前のコードに当てれば確実に落ちる**位置に置かれています。指摘した不具合そのものを再現するテストになっており、回帰の番人として機能します。

`docs/tasks/027-wish-list.md` の完了条件「`security-auditor` の監査で High 以上がゼロ」は**満たされました。**

### 残存する範囲（新規指摘ではなく、番人の射程の記録）

| 重大度 | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| Low | `apps/api/test/me.test.ts:473` | 検出条件が `` /`couple_id`/ `` というバッククォート付きの正規表現で、drizzle が生成する `CREATE TABLE` の書式に依存している。手書きのマイグレーションで `couple_id text not null` とバッククォート無しに書いた表は、番人の網から静かに外れる | `` /[`"(,\s]couple_id[`"\s]/ `` 程度に緩めるか、少なくとも「この検出は drizzle 生成のバッククォート書式を前提にする」とコメントに1行残す。緩める場合は既存5表が引き続き検出されることを実測で確認すること |
| Informational | `apps/api/test/me.test.ts:484` | この番人が守るのは **`couple_id` 列を直接持つ表**だけである。`reactions` のように列を持たず `posts` 経由で紐づく表は射程外で、いまは :336 の手書きアサーションが守っている。次に「`posts` の子テーブル」を足したときは、027 と同じ形で漏れうる | 対処不要。ただし `posts`/`events` の子テーブルを足すタスクが来たときは、この番人が守らないことを前提に置くこと |
| Informational | `apps/api/src/procedures/me.ts:195-200`（`coupleId` が引けない分岐） | `wishes.created_by → user.id` の FK により、この分岐に wish を持つ利用者が入ると最終行の `DELETE FROM user` が落ちうる。ただし到達には `couple_members` が `me.delete` の外で消えている必要があり、`posts.author_id` に**027以前から同じ性質がある**（:500 の「受け入れている制約」テストが固定している状態と同種）。027 が新たに作ったものではない | 対処不要。既に受け入れている制約の範囲として扱ってよい |

### Low 3件の扱いについて

| 指摘 | 性質 | 見立て |
|---|---|---|
| `list.tsx` の二重発火防止漏れ（`apps/app/app/(tabs)/list.tsx:163`） | 既に書いてある規約への準拠。`conventions.md`「副作用を伴うボタンは二重発火を防ぐ」と `docs/tasks/027-wish-list.md` 3節の両方が明文で要求しており、`compose.tsx`・`calendar.tsx`等と実装も揃っている | A に上げる必要はない。仕様判断ではなく規約からの逸脱の是正。`disabled={!canSubmit \|\| createWish.isPending}` の1行で027の中で直してよい |
| title の制御文字・双方向制御文字 | 仕様判断。`post.body` も同じ性質を持つため、wish だけに正規化を入れると入力検証の規則が2系統に割れる | A へ。「投稿本文とwishタイトルに共通の正規化を置くか」という設計の問い |
| 論理削除で200件上限を回避できる | 仕様判断（ドキュメントの表現の問題）。実装のバグではなく、「200件上限」が行数の上限だと読まれうるという記述の問題 | A へ。直すとしても`docs/tasks/027-wish-list.md`5節への1行追記で、コードは触らない |
