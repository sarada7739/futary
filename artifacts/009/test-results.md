# 009: リアクション — テスト結果

実行日: 2026-08-29 / セッションB

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

## `pnpm test`（M2まとめ監査の対応後・最終状態）

```
packages/ui test:  Test Files  2 passed (2)
packages/ui test:       Tests  7 passed (7)
apps/app test:  Test Files  5 passed (5)
apps/app test:       Tests  27 passed (27)
apps/api test:  Test Files  9 passed (9)
apps/api test:       Tests  128 passed (128)
```

内訳（新規/変更ファイル）:

- `apps/api/test/reaction.test.ts`（新規） — `reaction.toggle` と `post.list` の集計の単体〜結合テスト
  - 付与・取り消し（トグル）ができること
  - 同じユーザーが同じ投稿に同じ種別を二重に付けられないこと（`reactions` テーブルの主キー制約。
    直接 INSERT を2回試みて2回目が `UNIQUE constraint failed` で拒否されることを確認）
  - 2人のユーザーが同じ投稿に付けると、それぞれ独立してカウントされること
  - 他ペアの投稿IDを指定すると `NOT_FOUND`（006の `post.delete` と同じ形。リアクションが作られないことも確認）
  - 存在しない投稿ID・削除済みの投稿を指定すると `NOT_FOUND`
  - 未認証 `FORBIDDEN` / 未所属 `NEEDS_ONBOARDING`
  - **N+1回避の証跡**: `D1Database#prepare` の呼び出し回数を `Proxy` でカウントし、投稿2件・
    リアクションありの `post.list` が `readProcedure` の couple_id 解決1回 + 投稿一覧1回 +
    リアクション集計1回の**計3回**で完結すること（投稿件数が増えても回数が変わらないことが
    N+1でない証拠）。投稿0件のときは集計クエリ自体を発行しない（2回）ことも確認
  - 未認証（デモ閲覧）では `reactedByMe` が常に `false` になること
- `apps/api/test/authorization.test.ts`（変更） — `security-requirements.md` 3節の5項目チェックリストに
  `reaction.toggle` を追加
  - 2. 未認証での書き込み（`reaction.toggle`）が `DEMO_COUPLE_ID` 設定有無に関わらず `FORBIDDEN`
  - 4. 未所属ユーザーが `reaction.toggle` を呼ぶと `NEEDS_ONBOARDING`
  - 「認可の基底を経由しない手続きが無い」の実在数チェックを 11→12 に更新
    （health.get/me.get + couple 3 + invite 2 + post 4 + reaction 1）
  - 既存の005〜008由来のテスト（couple/invite/post）はすべて維持され緑
- `apps/app/test/reaction.test.ts`（新規） — `lib/reaction.ts` の `toggleReactionOptimistically` の単体テスト
  - 未反応 → 反応（件数+1・reactedByMe: true）
  - 反応 → 未反応（件数-1・reactedByMe: false）
  - 相手だけが反応している投稿に自分も反応すると件数2
  - 元の `Post` オブジェクトを書き換えない（イミュータブル）
- `apps/app/test/home-timeline.test.tsx`（変更） — 楽観的更新の巻き戻しを結合テストで確認
  - `orpc.reaction.toggle` をわざと未解決の Promise のまま保持し、
    **サーバ応答前に画面の見た目が変わっている**ことを確認（楽観的更新が実際に「待たない」ことの証拠）
  - toggle が失敗（reject）したら、楽観的更新前の見た目に戻ることを確認
- `apps/app/test/post-card.test.tsx`（新規） — `PostCard` のリアクションボタン単体テスト
  - `onToggleReaction` が渡されていれば表示され、無ければ表示されない
    （未認証のデモ閲覧でボタンを出さない、というM2まとめ監査 Low対応の回帰テスト）
  - 件数0のときは絵文字のみ、反応済みのときは `❤️ <件数>` を表示すること

## M2まとめ監査（006・008・009）への対応で追加したテスト

- `apps/api/test/reaction.test.ts` に「kind に heart 以外の値は CHECK 制約で拒否される」
  「投稿を削除するとリアクションも一緒に削除される」「他ペアの投稿IDを指定した削除が
  NOT_FOUND のとき、対象と無関係な reactions は消えない」を追加

## N+1回避の設計

`post.list` はページ内の投稿ID一覧をまとめて `reactions` テーブルへ1回の
`SELECT ... WHERE post_id IN (...) GROUP BY post_id, kind` で問い合わせる
（`apps/api/src/procedures/post.ts` の `fetchReactionSummaries`）。投稿件数に関わらず
リアクション集計のクエリ回数は1回のまま（`readProcedure` の couple_id 解決を含めても
投稿一覧取得1回 + 集計1回の計2回、全体では3回）。投稿が0件のときは
`IN ()` が不正なSQLになるため、集計クエリ自体をスキップする。

## 実装メモ（設計判断の記録）

- `reaction.toggle` の他ペア投稿への到達防止は、`reactions` テーブル自体が `couple_id` を
  持たないため、DELETE/INSERT 双方の WHERE 句に
  `EXISTS (SELECT 1 FROM posts WHERE id = ?1 AND couple_id = ?4 AND deleted_at IS NULL)` を
  含める形にした（006の `post.delete` と同じ「WHERE 句で保証する」方針を、集計元テーブルが
  異なる場合にも適用したもの）。まず DELETE を試み、0件なら「そもそも無かった」のか
  「対象投稿が自ペアに無い」のかを INSERT 側の同条件で判定する
  （INSERT が0件なら投稿が自ペアに無い＝`NOT_FOUND`。UNIQUE違反は同時リクエストのレースとして
  `reacted: true` を返す）。「SELECTしてから判断して書く」の2段階にはしていない
  （architecture.md 4節）
- リアクション集計の応答は `reactions: [{ kind, count, reactedByMe }]` という配列にした。
  architecture.md 5節には具体的なレスポンス形が書かれていないため、`kind` が `heart` の1種の
  間も配列にしておくことで、種類が増えたときに `postSchema` 自体を変えずに済むようにした
  （B の設計判断。種類を増やすかどうかの判断自体はレビュー時に R が行う。state.md 論点L4）
- UI の楽観的更新は `apps/app/lib/reaction.ts` の純粋関数 `toggleReactionOptimistically` に
  切り出した。`app/(tabs)/index.tsx` の `useMutation` の `onMutate`/`onError`/`onSettled` から
  呼び出す（`onMutate` でキャッシュを直接書き換え、失敗したら `onMutate` が保存したスナップショットに
  戻す。成功・失敗どちらでも `onSettled` でサーバの実際の値に最終的に上書きする）
- リアクションボタンは既存の `packages/ui` の `Button`（`variant="ghost"`）をそのまま再利用した。
  二重発火防止ガード（conventions.md 4節）を個別実装せずに済み、「副作用のある操作に生の
  `Pressable` を使わない」規約にも従える。表示は `🤍`/`❤️` の絵文字 + 件数（0件のときは件数を隠す）

## M2まとめ監査（`security-audit-raw.md`）への対応

- `isConstraintViolation`（`couple.ts`）は制約違反全般に一致するため、`reaction.toggle` 固有に
  UNIQUE 違反だけへ絞る `isUniqueConstraintViolation` を用意した
- `reactions.kind` に `CHECK (kind IN ('heart'))` を追加（`0006_reaction_kind_check.sql`）。
  未知の kind が入ると `post.list` の出力検証全体が壊れる、という壊れ方を宣言的制約で防いだ
- 未認証（デモ閲覧）では `app/(tabs)/index.tsx` が `onToggleReaction` を渡さないようにし、
  `PostCard` はそれを受けてボタン自体を出さない
- `post.delete` を `db.batch()` 化し、`DELETE FROM reactions WHERE post_id = ?1` を同じ batch に
  含めることで論理削除時にリアクションも消えるようにした。**この対応中に自己発見した問題**:
  推奨どおり `couple_id` 条件を付けずに `DELETE FROM reactions WHERE post_id = ?1` だけを足すと、
  他ペアの投稿IDを指定した削除で `UPDATE`（couple_id条件あり）は0件のまま `NOT_FOUND` になる一方、
  `DELETE`（couple_id条件なし）だけが無条件で成立してしまい、**「投稿は消せないがリアクションだけ
  消せる」経路が生まれた**。回帰テストで実際にこの状態を検出し、`DELETE` 側にも
  `EXISTS (SELECT 1 FROM posts WHERE id = ?1 AND couple_id = ?2)` を追加して塞いだ
  （詳細は `docs/security-report.md` の当該エントリ参照）

## 未確認（人間の実機確認待ち）

Google OAuth ログインが要るため、実際のブラウザでのリアクションボタンのタップ・見た目・
楽観的更新の体感速度はこのセッションでは確認できていない（003・007・008と同じ制約。
`conventions.md` 8節の手順に従い、条件を満たしたことにはせず `docs/state.md` に未達として
記録した）。009はM2の最後のタスクのため、008で取れなかったスクリーンショット
（`state.md` L38）とあわせて、M2受け入れ判定でまとめて回収する。
