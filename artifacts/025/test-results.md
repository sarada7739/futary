# 025: 招待コードの再発行 — テスト結果

## サーバ側

`apps/api/src/procedures/couple.ts`の`invite.issue`に、既に2人揃っている
ペアからの呼び出しを`FORBIDDEN`で拒む処理を追加した。`couple_members`の
`slot`列（1ペア2人まで）はDBのUNIQUE制約で担保しており、通常はアプリ
ケーション側で人数を数える処理を持たない（`packages/db/src/schema/couple.ts`
のコメント）が、その制約は`invite.accept`（参加しようとした瞬間）にしか
効かない。満員のペアでも`invite.issue`自体は何の制約にも触れず成功して
しまい、誰も使えないコードを発行し続けられるため、ここだけ例外的に
`SELECT COUNT(*) FROM couple_members WHERE couple_id = ?1`で数える。

`apps/api/test/invite.test.ts`:
- 新設「ペアが2人揃っていると発行できない（FORBIDDEN）」: 所有者・相手
  どちらから呼んでもFORBIDDEN
- 既存「1ペアに3人目は入れない」を修正: 満員ペアでは`invite.issue`自体が
  拒否されるため、正規の経路では検証用の有効なコードを作れなくなった。
  期限切れコードのテストと同じ手法で`invites`テーブルへ直接差し込み、
  DB側の防御（`slot`のNOT NULL制約）自体は変わらず効いていることを確認

`pnpm --filter @futary/api test`: 304件全て緑（invite.test.ts単体で20件）。

## クライアント側

`apps/app/app/(tabs)/profile.tsx`に招待コードカードを追加した。

- `stats.get`（`members`）でペアの人数を見る。他の問い合わせと同じく
  `viewerKey`をqueryKeyに含める（T9。`viewer-key-coverage.test.ts`の
  走査対象。`orpc.stats.get.queryOptions()`という既存の呼び出しパターンの
  ため、新しい呼び出し箇所も自動的に検査対象になることを確認済み）
- ペアが1人のときだけ「招待コードを発行する」ボタンを出す。2人揃って
  いるときは「相手が参加済みです」と表示しボタンは出さない
- 発行前に「発行すると、以前発行した招待コードは無効になります」と
  常時表示する（押したあとに気づく形にしない。025タスク定義）
- 発行すると`invite.issue`を呼び、コード・有効期限・共有ボタンを表示する
- 失敗時はエラーメッセージを表示する

`apps/app/test/profile-screen.test.tsx`に4件追加（既存14件は変更なしで
全て緑。`stats.get`の呼び出しが新設されたため、既存のモック設定に
`statsGetMock.mockResolvedValue(makeStats())`をデフォルトとして追加した）:
- ペアが1人のとき、押す前の注意書きと発行ボタンが出る
- ペアが2人揃っているとき、発行ボタンは出ず「相手が参加済みです」が出る
- 発行ボタンを押すと`invite.issue`が呼ばれ、コードと有効期限が表示される
- 発行に失敗するとエラーメッセージが出る

`pnpm -w test`: apps/app 166件・apps/api 304件、全て緑。
`pnpm run type-check`・`eslint .`、両方通過。

## 未確認（実機）

マイページは認証必須のため、B（自動化）は実機確認ができない。
`artifacts/025/manual-check.md`に確認項目を列挙した。
