# 024: アカウント削除と退会 — テスト結果

## 削除順序（訂正版。docs/tasks/024-account-deletion.md参照）

```
1. reactions（postsとuserを参照）
2. posts
3. events
4. invites / invite_failures
5. couple_members ← ここまで来れば、あとはcouple_idが要らない
6. couples
7. userを消す（sessionとaccountはON DELETE cascadeで落ちる）
```

`resolveCoupleContext`はcouple_membersからcouple_idを解決するため、
couple_membersを消す前に`coupleId`をローカル変数へ確保しておく
（`apps/api/src/procedures/me.ts`の`meDelete`ハンドラ）。
`resolveCoupleContext`自体には触れていない（削除専用の例外を認可の要に
開けないため。005がまさにそれを潰した、という判断をそのまま踏襲）。

R2は行から鍵を集めず、接頭辞（`couples/{coupleId}/posts/`・
`users/{userId}/profile/`。2人分）で消す（`deleteAllByPrefix`）。
削除の順序から独立しており、`post.delete`とは異なりR2の失敗を
握りつぶさない（catchせずそのまま投げる。error-id.tsが詳細をログへ、
利用者にはIDだけを返す）。

## サーバ側テスト（`apps/api/test/me.test.ts`の`describe("me.delete", ...)`）

- 未認証ならFORBIDDEN
- ペア未所属でも削除でき、自分のプロフィール画像もR2から消える
- ペアの全データ（投稿・リアクション・イベント・招待コード・
  プロフィール画像2人分）が消え、相手もどの手続きからもペアのデータを
  読めなくなる（Candle型: 相手のuser行自体は残る）
- **couple_membersを消した時点で、残りの行が残っていても両方の利用者が
  ペアを読めなくなる**（タスク定義の証明項目。実際の削除手順1〜5を
  SQLで直接再現して確認）
- **各段（reactions/posts/events/invites削除後）で1回止めて再実行しても、
  最後まで進み同じ結果になる**（タスク定義の証明項目。it.eachで5パターン
  検証）
- 【受け入れている制約として明示】couple_members削除直後（手順5と6の間）に
  止まると、couplesの行はcoupleIdを引く手段が無くなり孤児として残る。
  A・Rが「残る。それは受け入れる」と明記した挙動をテストとして固定した
  （挙動が変わったらこの判断自体を見直す必要がある、という注記付き）
- userを削除するとsessionとaccountがON DELETE CASCADEで自動的に消える
- **順序の証明**: invite_failuresを残したままuserを消そうとするとFK制約で
  失敗し、先に消せば通ることを直接確認
- 削除後、同じGoogleアカウントで登録し直しても前のペアに戻らない
  （新しいuser.idになるため。Better Authのaccount行が無くなっている
  ことでこの動きになる、という前提を新しいuser行の作成で模擬）

`apps/api/test/authorization.test.ts`（security-requirements.md 3節の
認可テスト）: `me.delete`が`authedProcedure`を使っているため走査に
自動的に含まれ、緑。

`pnpm --filter @futary/api test`: 317件全て緑（me.test.ts単体で29件）。

## クライアント側

`apps/app/app/(tabs)/delete-account.tsx`を新設。マイページ下部に
「アカウントを削除」の入口を追加した（`profile.tsx`）。

- 段階1: 何が消えるか（投稿・写真・カレンダー・記念日・統計）を列挙
- 段階2: 相手のデータも消えること（相手の投稿・リアクション・
  プロフィール画像）・相手には事前に知らせないことを明記。チェックを
  入れるまで最終ボタンが押せない（「既定で押せる状態にしない」）
- 削除成功後は`signOut()`を呼ぶ（セッションはサーバ側で既に消えている
  が画面が知らないため）。明示的なnavigateはしない——識別が変わることで
  `_layout.tsx`のStack.Protectedが自然にサインイン画面へ導く
  （PR #177の教訓をそのまま踏襲）

`apps/app/test/delete-account-screen.test.tsx`を新設（7件）:
- 段階1の内容・段階2への遷移
- 段階2の警告文言（相手の投稿・リアクション・プロフィール画像・
  事前に知らせない旨）
- チェックを入れるまで最終ボタンが押せない
- 最終ボタンを押すとme.deleteが呼ばれ、成功するとsignOutが呼ばれる
- 失敗するとエラーメッセージが出て、signOutは呼ばれない
- 「やめる」でrouter.back()

`apps/app/test/profile-screen.test.tsx`に1件追加（「アカウントを削除」を
押すとdelete-accountへ遷移する）。既存テストは`useRouter`の新規使用に
伴い`expo-router`のモックを追加した（他の画面結合テストと同じ形）。

`pnpm -w test`: apps/app 175件・apps/api 317件、全て緑。
`pnpm run type-check`・`eslint .`、両方通過。

## security-auditor

削除は認可を触るため実行中（タスク定義の完了条件）。結果はこのファイルへ
追記する。

## 未確認（実機）

マイページ・アカウント削除画面は認証必須のため、B（自動化）は
ブラウザで直接開いて確認することができない。`artifacts/024/manual-check.md`
に確認項目を列挙した。
