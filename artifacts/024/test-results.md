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

`pnpm -w test`: apps/app 176件・apps/api 321件、全て緑。
`pnpm run type-check`・`eslint .`、両方通過。

## security-auditor

**High以上はゼロ**（タスク定義の完了条件を満たす）。Medium 4件・Low 6件の
指摘のうち、実装レベルで直せるものは全て対応した。詳細は
`docs/security-report.md`に記録。

### 対応済み

- **【Medium】並行書き込みによる回収不能な孤児**: reactions〜couples
  （手順1〜6）を個別の`run()`ではなく`db.batch()`1本にまとめた。削除
  実行中に別リクエストが新しい投稿・予定・招待を作ると、その行が削除より
  後に着地し、`couples`のFK違反で処理が止まる。その時点で`couple_members`
  は既に消えているため再実行時に`coupleId`を引けず、本文・`image_key`を
  持つ行が回収不能な孤児として恒久的に残り、削除実行者がその投稿の著者
  なら以降の`user`削除が永久に失敗しかねない、という指摘。`db.batch()`の
  原子性（文のエラーでロールバックする。`couple.ts`の
  `isConstraintViolation`と同じ根拠）でこの窓自体を無くした。当初
  「残る」と受け入れていた孤児`couples`行も同時に解消される
- **【Medium】R2一括削除の窓**: D1削除前の1回だけだと、その最中に着地した
  オブジェクトを誰も回収できない。D1の`db.batch()`成功後にもう一度
  `deleteAllByPrefix`を呼ぶようにした
- **【Low】相手のuser.imageが消したR2キーを指したまま残る**: `me.ts`の
  不変条件「image列が非NULLなら実体がある」が破れるため、相手のプロフィール
  画像を消す際に相手の`user.image`もNULLへ戻す文を同じbatchに含めた
- **【Low】is_demoのペアへのガードが無い**: 現状はseedの都合
  （email_verified=0・@example.com）で到達不能だが、手続き自身でも拒む
  ガードを追加した
- **【Low】無関係な第2のペアを巻き込むバグを検知するテストが無い】**:
  別のペアのデータ・R2オブジェクトが影響を受けないことを直接確認する
  テストを追加。`authorization.test.ts`の「未認証アクセスでFORBIDDEN」の
  一覧にも`me.delete`を追加した
- **【Low】端末側のキャッシュ残存**: 削除成功後に`queryClient.clear()`を
  呼ぶようにした（viewerKeyでの隔離=T9に加えて、削除は「見えなくする」
  ではなく「消す」操作であるため）
- **【Low】R2エラーメッセージに画像キーが含まれうる】**:
  `deleteAllByPrefix`が自分でcatchし、鍵を含まない汎用メッセージへ
  詰め替えてから投げる形にした（`security-requirements.md` 8節）
- **【Low】削除成功後にsignOut()が失敗すると「削除できませんでした」と
  誤表示する**: 削除の成否とsignOut()の成否を別に扱うよう修正した
  （旧コードで実際に誤表示することを実測してから直した）

### Aへ判断を仰いだ（設計判断が必要なため実装を保留）

- **【Medium】招待コードのレート制限カウンタのリセット**: `invite_failures`
  を`user_id`で削除すると、その行が持つ`ip_address`側のカウンタも
  同時にリセットされる。「10回失敗→アカウント削除→同じGoogleアカウントで
  再登録→また10回」を繰り返せてしまい、`security-requirements.md` 4節が
  想定していた「回避にはGoogleアカウント自体を作り直す必要があり、
  コストが桁違いに高い」という前提が崩れる
- **【Medium】不可逆かつ相手のデータまで巻き込む操作に、再認証やレート
  制限が無い**: セッションを奪われた場合の被害が「閲覧」から「2人分の
  データの恒久破壊」へ拡大した、という指摘

詳細はAへのメッセージ・`docs/security-report.md`参照。

## 未確認（実機）

マイページ・アカウント削除画面は認証必須のため、B（自動化）は
ブラウザで直接開いて確認することができない。`artifacts/024/manual-check.md`
に確認項目を列挙した。
