# security-auditor 生の返答（021: 予定の持ち主とふたりの予定）

実行日: 2026-08-31

---

監査を終えました。以下、報告です。

---

### [2026-08-31] 監査対象: 021 予定の持ち主とふたりの予定（`apps/api/src/procedures/event.ts` / `packages/contract/src/event.ts` / `packages/db` マイグレーション / `apps/app` カレンダー）

| 重大度 | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| **High** | `packages/db/migrations/0010_lyrical_chronomancer.sql:19` | 表の作り直しで `INSERT INTO __new_events(...,"is_shared",...) SELECT ..., "is_shared", ... FROM events` としているが、**0010 適用前の `events` に `is_shared` 列は存在しない**（`0007_event.sql:1-13` が作り、`0008_...:19` が足したのは `time` だけ）。SQLite は解決できない二重引用符を**文字列リテラル**として扱うため、この文はエラーにならず全既存行の `is_shared` に文字列 `'is_shared'` を書き込もうとする。`kind <> 'plan'` の既存行では `events_is_shared_check`（`is_shared = 0 OR kind = 'plan'`）に落ちて**マイグレーションが途中で失敗**し、`__new_events` が残る。`kind='plan'` の行だけなら通ってしまい、**021 の認可が依存する列に文字列が入る**。テストは `applyD1Migrations`（`apps/api/test/apply-migrations.ts:5`）が空のDBに適用するため0行コピーとなり、**この欠陥を構造的に検出できない**（`artifacts/021/test-results.md` の260件緑は、この文が空表では通ることの裏付けでもある）。`docs/state.md:45-49,79-89` のとおりリモートD1には0008・0009適用済みで実データ（記念日・会った日）があるため、**適用時に確実に顕在化する**。悪用可能性は無いが、影響は認可列そのものと本番データに及ぶ | SELECT 側から `"is_shared"` を外し、既存9列だけをコピーして DEFAULT 0 を効かせる（`INSERT INTO __new_events("id","couple_id","date","title","kind","repeat_yearly","time","created_by","created_at") SELECT 同列 FROM events;`）。適用前にリモートの複製に対して `SELECT "is_shared" FROM events` を実行し、列参照ではなく文字列が返ることを自分の目で確認する。あわせて「行が入った状態のDBにマイグレーションを適用する」検査をCIかローカル手順に置く |
| **Medium** | `apps/api/src/procedures/event.ts:168`（`SET ... kind = ?3`）と `:170` の WHERE | UPDATE の WHERE は**更新前の行**で評価されるため、`kind` の変更そのものは認可の対象外になっている。結果、`anniversary` / `meetup` を**片方の判断だけで非共有 `plan` に変換**でき、その行は以後もう1人が編集も削除もできなくなる。`docs/tasks/021-plan-ownership.md:46-52` は「anniversary・meetup はどちらでも編集・削除できる」を不変条件として書いているが、行はその区分から一方的に出られる。片側からの権限剥奪であり、相手には**元に戻す手段が無い**（削除もできない）。`event.test.ts:323-330` の突き合わせ表は更新時も同じ `kind` を送るため、この遷移は1件も通っていない | `kind` を更新で不変にする（WHERE に `AND kind = ?` を足す）か、`plan` への変換を設定者に限る規則をAが決めて WHERE と `computeCanEdit` の両方へ落とす。決めた遷移規則を8通りの表と同じ形でテストに追加する |
| **Medium** | `apps/api/test/authorization.test.ts`（describe が 1・2・3・4・5・7 のみ。6が無い） | `docs/security-requirements.md:43,54-59` は項目6（`DEMO_COUPLE_ID` が実在するが `is_demo` でないペアを指すとき拒否）を必須とし、**「5 のテストは冒頭のガードで止まるため `AND is_demo = 1` を外しても1件も落ちない」**と明記している。にもかかわらず、`auth-category` の照合（`apps/api/src/middleware/auth-context.ts:39` の `AND is_demo = 1`）を守るテストがリポジトリ全体に存在しない（`is_demo` を含むテストは `authorization.test.ts:63` と `reaction.test.ts:263` の `is_demo=1` 挿入のみ）。021 は認可を触るタスクであり、同3節は7件すべてが緑であり続けることを求めている。T4（デモ経路からの本番データ漏洩）の唯一の防御線が無防備 | `authorization.test.ts` に describe 6 を追加する。`is_demo=0` の実在ペアを作り、その id を `demoCoupleId` に渡して未認証で `couple.get` / `post.list` / `event.list` が `FORBIDDEN` になることを固定する |
| **Medium** | `packages/db/src/schema/event.ts:47` の CHECK と `apps/api/test/schema-integrity.test.ts:36` | `docs/tasks/021-plan-ownership.md:236` が求める「`is_shared` を `plan` 以外に立てられない（**入力・CHECK の両方**）」のうち、**どちらのテストも存在しない**。入力側は `event.create` に `kind='anniversary', isShared=true` を渡して `INVALID_INPUT` になることを見ていない（`event.test.ts` の `isShared: true` は `kind='plan'` の2件だけ）。DB側は `schema-integrity.test.ts` が `WHERE type IN ('index','trigger')` で走査するため、**表に付いた CHECK は網の外**である。0010 はまさに表の作り直しであり、018 で制約が消える形を踏んだのと同じ操作。CHECK が黙って落ちても誰も気づけない | (1) 契約側: `kind='anniversary'`/`'meetup'` × `isShared=true` が `event.create`・`event.update` の両方で弾かれるテストを足す。(2) DB側: `INSERT INTO events (..., kind='anniversary', is_shared=1)` を直接実行して失敗することを固定する。あわせて `schema-integrity.test.ts` の走査に `type='table'` の `sql` 突き合わせ（`events` の2つの CHECK）を加える |
| **Low** | `apps/api/src/procedures/event.ts:39`（`if (viewerId === null) return false;`） | デモ閲覧者に `canEdit=false` を返す唯一の防御線だが、**未認証コンテキストで `event.list` を呼ぶテストが1件も無い**。この行が消えると `kind !== "plan"` が先に真になり、記念日・会った日の `canEdit` が未認証の閲覧者に `true` で返る。書き込みは `writeProcedure`（`base.ts:74`）が止めるため実害はUIに留まるが、読み取り経路の表明が試験されていない | `authorization.test.ts` の describe 3 に「デモペアの `event.list` が返す全件で `canEdit === false`」を追加する。`kind` は3種すべて置くこと |
| **Low** | `apps/app/app/(tabs)/calendar.tsx:55` | `!event.canEdit` のとき常に「・編集は設定者のみ」と表示する。デモ（未認証）閲覧では全件 `canEdit=false` になるため、持ち主の概念が無い記念日・会った日にもこの注記が出る。情報漏洩ではないが、権限規則の説明として誤り | 注記を `event.kind === "plan" && !event.canEdit` の条件に絞る。読み取り専用であること自体は別の表現にする |
| **Low** | `packages/db/migrations/0010_lyrical_chronomancer.sql`（ファイル名） | 既存は `0007_event` / `0008_event_time_and_meetup_unique` / `0009_couple_dates` と内容を表す名前で揃っているが、0010 だけ drizzle-kit の自動生成名のまま。運用時に「何を変えた回か」がファイル一覧から読めない | `0010_event_is_shared.sql` 等へ改名する（未適用のうちに。適用後は `_journal` との整合に注意） |

### 指摘に至らなかった確認点（依頼のあった5点への回答）

1. **`eventUpdate` / `eventDelete` の WHERE の一致** — 一致している。`event.ts:170` と `:200` はいずれも `(kind <> 'plan' OR is_shared = 1 OR created_by = ?)` で、片方だけ緩い書き方にはなっていない。プレースホルダの割り当ても正しい（update は `?7=id, ?8=coupleId, ?9=userId`、delete は `?1=id, ?2=coupleId, ?3=userId`。SET 側の6引数とずれていない）。`couple_id = ctx.coupleId` は両方に入っており、引数に `coupleId` は現れない。権限不足を `NOT_FOUND` に一本化している点も、他ペアIDとの区別を与えない形で正しい。
2. **`computeCanEdit`（`event.ts:38-41`）と WHERE の一致** — 表現として一致している。`kind !== "plan" || isShared || createdBy === viewerId` は SQL の3項と同じ順・同じ意味で、`event.test.ts:289-298` の8通りが `event.list` の `canEdit` と `event.update` / `event.delete` の実際の可否を突き合わせている。**ただし上記 Medium（kind の変更）の遷移だけが表の外**にある。
3. **未認証（デモ）閲覧者の扱い** — `resolveCoupleContext`（`auth-context.ts:43`）が `userId: null` を明示的に返し、`computeCanEdit` の冒頭で `false` に落ちる。`canEdit` が誤って `true` になる経路は読んだ限り無い。テストが無い点のみ Low として挙げた。
4. **`is_shared` を `plan` 以外に立てられないこと** — 契約側は `refineIsSharedKind`（`contract/src/event.ts:94-99`）が create（`:101`）と update（`:114`）の両方に適用済み。DB側は `schema/event.ts:47` と migration の CHECK。**入力スキーマを通らない書き込み口は現時点で存在しない**（`event.create` の `ON CONFLICT` は `WHERE kind = 'meetup'` の部分UNIQUE索引が対象で、`plan` の行には発火しない。また `DO UPDATE` は `is_shared`・`kind` を更新しない）。層としては両方揃っているが、**どちらも試験されていない**ため Medium とした。
5. **`is_shared` の不正な書き換えによる昇格** — 見つからなかった。`is_shared` を書けるのは `event.update` だけで、その UPDATE は**更新前の行**で認可を評価する。共有でない `plan` の非設定者は WHERE を通れないため、`is_shared=1` を送って自分に権限を付ける経路は成立しない（`authorization.test.ts:441-459` が実際に固定している）。`created_by` を書き換える経路も無い（`event.create` は常に `userId` を入れ、`event.update` の SET に `created_by` は無い）。

**High は1件（マイグレーション）です。認可ロジックそのものからは High 以上を検出していません。** 021 の完了条件「High 以上ゼロ」は、0010 の SELECT 列を直してから再確認するのが妥当だと考えます。

関連ファイル:
- `C:\Users\coco7\futary\packages\db\migrations\0010_lyrical_chronomancer.sql`
- `C:\Users\coco7\futary\packages\db\migrations\0007_event.sql`
- `C:\Users\coco7\futary\packages\db\migrations\0008_event_time_and_meetup_unique.sql`
- `C:\Users\coco7\futary\apps\api\src\procedures\event.ts`
- `C:\Users\coco7\futary\apps\api\src\middleware\auth-context.ts`
- `C:\Users\coco7\futary\apps\api\test\authorization.test.ts`
- `C:\Users\coco7\futary\apps\api\test\event.test.ts`
- `C:\Users\coco7\futary\apps\api\test\schema-integrity.test.ts`
- `C:\Users\coco7\futary\packages\contract\src\event.ts`
- `C:\Users\coco7\futary\packages\db\src\schema\event.ts`
- `C:\Users\coco7\futary\apps\app\app\(tabs)\calendar.tsx`
