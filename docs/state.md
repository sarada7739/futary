# 現在地

> セッション開始直後・コンテキスト圧縮直後は、まずこのファイルを読む。
> ファイル変更を伴う作業の完了時は、必ずこのファイルを更新する。

**最終更新**: 2026-08-30 / セッションB（**011（カレンダーUI）、Rの受け入れを得て
mainへマージ済み（PR #89）。ブランチも削除済み。** `apps/app/lib/calendar.ts`
（月グリッドの日付計算。日〜土、A実測のPR #84の値をそのままテストの期待値に
した）・`apps/app/components/month-grid.tsx`（自前実装、28〜42日どちらでも
余分な行を作らない`flex-wrap`）・`event-form.tsx`（登録・編集モーダル。記念日
選択でrepeatYearly自動true）・`apps/app/app/calendar.tsx`（画面本体。月ナビ・
凡例・3状態）を実装した。ホームの導線は`(tabs)/index.tsx`ヘッダーに
「📅 カレンダー」ボタンを追加。**編集は射影後の表示日付ではなく登録日
（`event.sourceDate`）を対象にする設計にした**（表示日付のまま送ると、射影で
表示されている記念日の登録日そのものを動かしてしまうため。回帰テストで固定）。
種別マーカーは色（`colors.eventAnniversary`/`eventPlan`/`eventMeetup`。017の
`colors.overlay`と同じ形で`architecture.md`7節にも反映）とグリフ（●/■/▲）を
併用し、色だけに依存しない。テストはapps/app 55件（新規19件）・apps/api 181件
（無変更）・packages/ui 7件（無変更）すべて緑、型チェック・lint通過。
**Rの受け入れでは必須修正なし。**記録2件: (1) 日付計算が`apps/app/lib/calendar.ts`
と`apps/api/src/lib/date.ts`の2箇所に分かれた件（R-36。012・013が両側とも
日付計算を使うため、増える前にAへ判断を仰ぐ。L63として起票）、(2) 繰り返し
記念日の削除はどの年から操作しても全年から消える件（R-37。`artifacts/011/
manual-check.md`の実機確認項目に追加済み）。詳細は`artifacts/011/review.md`参照。
**カレンダー画面は認証必須のため、B（自動化）はブラウザでの実機確認ができない**
（003・004・007と同じ制約）。`artifacts/011/manual-check.md`に確認項目を列挙し、
L62として論点に起票。M3の受け入れでまとめて回収する。011単体のsecurity-auditor
監査は新しい手続きを増やしていないため不要（006・008・010と同じ扱い、Rも同意）。
**次はM3の012（統計カード）に着手する**（着手前にR-36の日付計算の置き場所に
ついてAの判断を待つか確認すること）。
010（カレンダーAPI）はRの受け入れを得てmainへマージ済み（PR #86）。
017（画像の全画面表示）はコード側完了・Rの受け入れ済みでmainへマージ済み
（PR #80）。**残るは人間の実機確認のみ**（Rが列挙した4項目。
`artifacts/017/manual-check.md`参照）)

---

## 現在のフェーズ

**M1（001〜005）完了。2026-08-29、人間の明示的な受け入れ確認を得た。**

**M2（006〜009）完了。2026-08-30、人間の明示的な受け入れ確認を得た。**
同時に L4（リアクションの種類）も**ハート1種のまま**で決定した。
実装・自動テスト・実機確認（`wrangler dev --remote` での操作）・R の受け入れを経ている。
**ただし M2 は視覚検証を通っていない**（L58。016 の全体監査で回収する）。

**次は M3。実行順は L59 の `fix/` → 017 → 010〜013。**
017 は M2 の受け入れ中に人間から出た要望（L54）なので、番号は後ろだが先頭に置く。
L59（画面の最大幅）を 017 の直前に置いたのは、どちらも PC 幅の見た目に関わり、
**人間の実機確認を1回で済ませられる**ため。

以下は 006〜009 の実装経緯（過去の記録として残す）。
006（投稿スキーマとAPI）はPR #33がRレビュー往復1回（必須修正なし）で受け入れられ、
mainへsquash merge済み。Rからの記録3件のうち旧L28・L30はAがPR #35で解決、
旧L29は`fix/write-procedure-narrow-member`（PR #37）としてBが対応しRの受け入れを得て
マージ済み。さらにAがRの先読み指摘2件（imageKeyをクライアントから受け取らない・
D1/R2の削除順序）をPR #38で反映済み。次は007（画像アップロード）着手。
以下は001〜006それぞれの実装経緯（過去の記録として残す）。

pnpm workspace / `packages/contract`（health.get）/ `apps/api`（Hono + oRPC + D1疎通）
/ `apps/app`（Expo Router + TanStack Query）/ CI を一通り繋いだ。
PR #1（ブランチ `task/001-walking-skeleton`）はレビュー往復2回でRの受け入れを得て、
squash mergeで `main` に取り込み済み（ブランチも削除済み）。
証跡は `artifacts/001/` を参照。

002は `packages/ui`（トークン + Text/Button/Card/Avatar/Screen）と
`apps/app/app/(tabs)/`（ボトムタブ5つ + FAB）を実装した。PR #3
（ブランチ `task/002-design-tokens-and-ui`）はレビュー往復2回でRの受け入れを得て、
squash mergeで `main` に取り込み済み（ブランチも削除済み）。
証跡は `artifacts/002/` を参照。

003はBetter Auth + Google OAuth + D1 + Expo SecureStoreを実装した。
`packages/db/src/schema/auth.ts`（user/session/account/verification）、
`apps/api/src/auth.ts`（Better Auth初期化）、`me.get`、ログイン画面
（`apps/app/app/(auth)/sign-in.tsx`）、`Stack.Protected` によるルーティングガード、
ログアウトを実装。security-auditor で High 2件検出→修正済み、Medium一部対応。
Rレビュー往復2回（R-17改: BETTER_AUTH_URL/TRUSTED_ORIGINSのホスト名検証、
R-18: fail-fast/CORS fail-closedのテスト追加）で受け入れを得て、PR #5
（ブランチ `task/003-auth-google`）を `main` へ squash merge 済み（ブランチも削除済み）。
詳細は `docs/security-report.md` と `artifacts/003/`。
**実際のGoogleアカウントでのログイン確認・Cookie属性の実地確認は未実施**
（人間の判断で「Google OAuthクライアント作成は今は後回し」となったため。
下記「次の一手」参照）。

PR #7・#8（`docs/conventions.md` のマージ戦略規定、D1にトランザクションが無い
前提への004/architecture.md修正）を規定の手順でsquash mergeし、`main`へ取り込み済み。

PR #16（worktreeのブランチ後片付け手順を`harness.md`に追加。squash mergeでは
`-d`ではなく`-D`が必要な理由も明記）・PR #17（005タスクファイルにあった
認可テストの5件目〈`DEMO_COUPLE_ID`未設定時のfail-closed〉を恒久側の
`security-requirements.md` 3節へ反映）を、人間からの指示によりレビュー結果
（いずれもコミット履歴上でRの指摘に対応済み）に従ってsquash mergeし、
`main`へ取り込み済み（ブランチも削除済み）。詳細は各PR本文参照。

004はペア作成と招待コードを実装した。`packages/db/src/schema/couple.ts`
（couples/couple_members/invites/invite_failures）、`apps/api/src/procedures/couple.ts`
（couple.create/get/update、invite.issue/accept）、招待コード生成
（`apps/api/src/lib/invite-code.ts`）、オンボーディング画面
（`apps/app/app/(onboarding)/`）を実装。D1にインタラクティブなトランザクションが
無い前提（architecture.md 4節）に従い、原子性は単一SQL文と`batch()`で表現した。
security-auditorを2回実行し、1回目でHigh 1件・Medium 3件・Low 5件、2回目
（1回目の修正確認）でMedium 1件・Low 2件を検出→全て修正済み（詳細は
`docs/security-report.md` と `artifacts/004/`）。テスト52件緑、型チェック・lint通過。
Rレビュー（PR未作成、`security-requirements.md`との齟齬〈L24〉の指摘）にも対応し、
PR #9を`main`へsquash merge済み（ブランチも削除済み）。
L24はAへエスカレーションし、Aが要件・タスクファイルを実装に合わせて修正した
PR #10も先にsquash merge済み。詳細は下記L24・L25参照。
**Google OAuthクライアント未設定のため、オンボーディング画面の実機確認は未実施**
（003のL14と同じ制約。下記「次の一手」参照）。

005は認可ミドルウェアを実装した。`apps/api/src/middleware/auth-context.ts`
の `resolveCoupleContext` が couple_id の解決を1箇所に集約する（認証済みは
`couple_members` から解決、未所属なら `NEEDS_ONBOARDING`。未認証は
`DEMO_COUPLE_ID` を `is_demo=1` のDB実データと突き合わせて解決し、
未設定・空文字・DB不一致なら `FORBIDDEN`。fail-closed）。
`apps/api/src/procedures/base.ts` に `readProcedure`/`writeProcedure`
（タスク定義の2種類）に加え `authedProcedure`（認証必須のみ・couple_id解決
なし）を追加し、couple配下の全5手続きが3基底のいずれかを必ず経由する
状態にした。security-auditorを2回実行し、Medium 2件（is_demo未検証、
couple.create/invite.acceptが基底を経由せず認可が2系統に割れていた）を
検出→修正・解消確認（High以上ゼロ）。Rレビュー往復2回
（router再帰走査による基底経由の機械的な検査を追加、assertionの強度を
「ミドルウェアが1つ以上」から「3基底のいずれかを含む」に強化）で受け入れを
得て、PR #19を`main`へsquash merge済み（ブランチも削除済み）。
詳細は `docs/security-report.md` と `artifacts/005/`。

006は投稿の永続化と取得を実装した。`packages/db/src/schema/post.ts`（`posts`テーブル。
`(couple_id, created_at)`複合インデックス）、`packages/contract/src/post.ts`
（`post.list`/`post.create`/`post.delete`）、`apps/api/src/procedures/post.ts`を実装。
`post.list`は`readProcedure`の上に載せ、`{createdAt, id}`をbase64エンコードした
不透明カーソルで1回20件固定のページングを行う（同一秒の投稿がページ境界を
またいでも重複・欠落しないことをテストで確認）。`post.create`/`post.delete`は
`writeProcedure`の上に載せ、画像情報は受け取って保存するだけ（アップロードは007）、
削除は`WHERE id=? AND couple_id=ctx.coupleId AND deleted_at IS NULL`の1文で論理削除する。
`security-requirements.md`3節の5項目チェックリストに投稿系3手続きを追加し
`authorization.test.ts`に反映。テスト90件（apps/api）緑、型チェック・lint通過。
security-auditorは起動していない（10節1の必須対象に該当せず、M2完了時にまとめる方針）。
詳細は`artifacts/006/test-results.md`と`docs/tasks/006-post-api.md`の実装メモ。
PR #33（ブランチ`task/006-post-api`）はRレビュー往復1回・必須修正なしで受け入れられ、
mainへsquash merge済み（ブランチも削除済み）。Rからの記録依頼3件は下記「未解決の論点」
L28〜L30を参照。

**2026-08-29、人間が実機でM1の残り確認項目をすべて実施した。**
実際のGoogleアカウントでのログイン成功（2アカウント）・D1への`user`/`account`
レコード作成・リロード後のログイン状態維持・Cookie属性（`HttpOnly`チェック済み・
`SameSite=Lax`。`Secure`はローカルhttp環境のため未チェックが正常）・
ログアウト→サインイン画面へ戻る導線・004のオンボーディング導線
（ペア作成→招待コード発行→別アカウントで参加）をすべて確認できた。
実機確認中に発見したバグ2件（callbackURLの相対パス問題、ボタン二重発火に
よるOAuth state競合）はPR #22で修正・マージ済み。詳細は
`artifacts/003/manual-check.md` と `docs/tasks/003-auth-google.md` の進捗節。

007は画像アップロード（R2）を実装した。`post.uploadUrl`（`imageId`をULIDでサーバ生成し、
R2の署名付きPUT URLを発行。有効期限5分）、`post.create`（画像はR2の実体確認
〈存在・サイズ8MB以内・Content-Type一致〉を経てから保存。本文か画像どちらか必須で
空投稿を拒否。旧L30）、`post.list`（署名付きGET URL・有効期限1時間を発行）、
`post.delete`（D1を先に更新しR2削除は失敗を握りつぶす。`image_key`は残す）を実装。
`packages/contract`の`post.create`は`imageKey`を廃止し`imageId`のみを受け取る形にした
（`coupleId`を含む鍵はクライアントから一切受け取らない）。R2の署名付きURL発行は
Workersバインディングでは不可能なため、S3互換APIをSigV4署名する`aws4fetch`を導入した
（`apps/api/src/lib/r2-signed-url.ts`）。`posts.image_key`にUNIQUE制約を追加
（`0004_post_image_key_unique.sql`）。`apps/app`にVitestベースのテスト基盤を初導入し
（React Native Testing Libraryは react-native 0.86 + React 19の組み合わせで動かず、
react-native-webエイリアス+jsdom+`@testing-library/react`に切り替えた。詳細は
タスクファイルの実装メモ）、`packages/ui`の`Button`に二重発火防止ガードを組み込んだ
（旧L26）。security-auditorを実行しHigh以上ゼロ。Medium 4件中3件・Low 1件中1件を
その場で対応済み（Content-Type検証の追加、imageIdのULID形式検証、他ペアimageIdの
テスト追加、Buttonの例外時ガード固着修正）。テストはapps/api 109件・apps/app 14件・
packages/ui 7件すべて緑、型チェック・lint通過。詳細は`docs/security-report.md`・
`artifacts/007/`・`docs/tasks/007-image-upload.md`の実装メモ。
**R2のS3互換API認証情報が`.dev.vars`に未設定のため、署名なしアクセスの拒否確認・
実際のアップロード実機確認は未実施**（003のGoogle OAuthクライアントと同じ制約。
下記「次の一手」参照）。PR #41はRレビュー往復1回・必須修正なしで受け入れられ、
mainへsquash merge済み（ブランチも削除済み）。**ただしRの指示により、実機確認
（署名なしアクセスの拒否）が済むまで007は「完了タスク」に移動しない**
（003・004と同じ扱い）。

Rからの記録依頼1件: R2のS3互換API認証情報が未設定の状態で画像付き投稿が
1件でもあると、署名生成が例外を投げるため`post.list`全体が500になる
（画像だけ欠落させる設計にはしていない）。fail-closedとして筋は通っており
デプロイ時の設定漏れにも気づきやすいため対応不要と判断されたが、記録のみ
残す（L33参照）。

009はリアクション機能を実装した。`packages/db/src/schema/reaction.ts`（`reactions`テーブル。
主キー`(post_id, user_id, kind)`、`kind`にCHECK制約）、`apps/api/src/procedures/reaction.ts`
（`reaction.toggle`）、`apps/api/src/procedures/post.ts`（`fetchReactionSummaries`による
N+1回避のリアクション集計）、`apps/app/lib/reaction.ts`（楽観的更新の純粋関数）、
`post-card.tsx`・`app/(tabs)/index.tsx`（リアクションボタンと`useMutation`の配線）を実装した。
`reaction.toggle`は`reactions`テーブルが`couple_id`を持たないため、DELETE/INSERT双方の
WHERE句に`EXISTS (SELECT 1 FROM posts WHERE id=?1 AND couple_id=?N ...)`を含める形で
他ペアの投稿への到達を防いだ（006の`post.delete`と同じ方針の応用）。リアクションの種類は
heartの1種のみで実装（論点L4。Bは増やしていない）。テストはapps/api 128件・apps/app 27件・
packages/ui 7件すべて緑、型チェック・lint通過。

`security-requirements.md`10節の方針（006・008は必須監査対象に非該当のためマイルストーン単位で
まとめる）に従い、009着手時にM2まとめ監査（006・008・009対象）をsecurity-auditorで実施した。
009固有の認可設計（`reaction.toggle`の他ペア到達防止・レース時の扱い・`post.list`集計の範囲・
デモ閲覧時の`reactedByMe`）は4点とも**指摘なし**。ただしLow 4件を検出し、いずれもタスク内で
対応済み: (1) `isConstraintViolation`の判定がUNIQUE以外にも一致していた問題→UNIQUE限定の
判定関数に変更、(2) `reactions.kind`に宣言的制約が無く未知の値で`post.list`全体が500になりうる
問題→CHECK制約を追加（`0006_reaction_kind_check.sql`）、(3) 未認証（デモ閲覧）でもリアクション
ボタンが押せてしまう問題→未認証時はボタン自体を出さないよう変更、(4) `post.delete`後も
`reactions`行が永久に残留する問題→`batch()`化してリアクションも同時削除するよう変更。
**(4)の対応中、推奨実装をそのまま適用すると「他ペアの投稿を指定した削除でリアクションだけ
消せる」新しい穴を自分で作ってしまったが、追加した回帰テストで実行時に検出し、
DELETE文にも`couple_id`条件をEXISTSで追加して修正した**（詳細は`docs/security-report.md`）。

**当初High 1件を検出**（`apps/api/src/index.ts`。oRPCのRPCHandlerがHTTPメソッドを見ないため
全ての書き込み手続きがGETで実行できる、という指摘）。009固有の変更ではなくAPI全体に
及ぶと判断し`fix/reject-get-writes`ブランチで別途対応したが、**この指摘自体が誤りだった
とRレビューで判明した。** `@orpc/server`の`RPCHandler`は既定で`StrictGetMethodPlugin`を
自動登録しており、GETは元々拒否されていた。**CSRFの脆弱性は存在しなかった。**
コード・回帰テストはそのまま残し（ライブラリの既定に依存しない防御）、記述をすべて
訂正した（下記L52参照。詳細は`docs/security-report.md`）。

詳細は`artifacts/009/test-results.md`・`artifacts/009/security-audit-raw.md`・
`docs/security-report.md`・`docs/tasks/009-reactions.md`の実装メモ。

**2026-08-30、人間が実機（`wrangler dev --remote`、Google OAuthログイン）で
008・009の動作確認を行い、「動作確認問題なし」の回答を得た。** 確認過程で
`workers.dev`サブドメインが実は登録済みだったことが判明し、リモートD1への
マイグレーション未適用・R2バケットのCORS未設定という2つの環境不備が
連鎖して発覚・解消した（詳細はL34参照。fix/compose-image-preview-layout側の
worklogに詳細あり）。あわせて、投稿作成画面で画像プレビューにより投稿ボタンが
押せなくなるUIバグを発見し`fix/compose-image-preview-layout`（PR #61）で
修正した。**さらに実機確認中、リアクションをタップすると投稿一覧の画像が
点滅する不具合が見つかった。** 原因は`onSettled`での無条件`invalidateQueries`
（`post.list`が呼ぶたびに画像の署名付きURLを再発行するため）。`onSettled`を
削除し楽観的更新の結果をそのまま信頼する形に変更して解消し、人間が実機で
再確認済み（本ブランチで対応。詳細は`artifacts/009/test-results.md`の
「実機確認」節）。

`fix/compose-image-preview-layout`はUIバグを修正した。2026-08-29、人間が
`wrangler dev --remote`（L34参照）で008・009の実機確認を行った際、投稿作成
画面で画像（特に縦長写真）を選ぶと画像プレビューが画面の高さを超え、下にある
「投稿する」ボタンが画面外に押し出されてタップできなくなる不具合を発見・
報告した。`compose.tsx`の本文・画像プレビューが単一の`View`（`flex: 1`）に
並びスクロール機構が無かったことが原因。本文・画像プレビューを`ScrollView`に
入れ、投稿ボタンは画面下部に固定する構成に変更し、画像プレビューにも
`maxHeight: 400`を設定した。回帰テストは追加していない（react-native-web +
jsdom の結合テスト環境ではレイアウトの実サイズを検証できないため）。人間が
実機で修正後の動作（縦長画像を含む複数の画像で投稿ボタンに到達できること）を
確認済み。テストは既存17件すべて緑。詳細は
`artifacts/fix-compose-image-preview-layout/manual-check.md`。

## プロダクト概要

futary — ふたり専用SNS。「ふたりの毎日を、もっと特別に。」
詳細は `docs/requirements.md`。

## マイルストーン

| M | タスク | 内容 | 状態 |
|---|---|---|---|
| M1 | 001〜005 | 足回り・デザイン基盤・認証・ペア成立・認可 | **完了**（2026-08-29、人間の受け入れ確認済み） |
| M2 | 006〜009 | 投稿・画像・タイムライン・リアクション | **完了**（2026-08-30、人間の明示的な受け入れ確認済み。L4 も同時に決定） |
| M3 | **017** → 010〜013 | **画像の全画面表示** → カレンダー・統計・思い出し | 着手中（017・010・011完了。次は012） |
| M4 | 014〜016 | ゲストデモ・LP・仕上げと公開 | 未着手 |

各マイルストーンの区切りで**人間が実際に触って**受け入れを判定する。

**タスク番号は識別子であって順序ではない。**実行順はこの表が持つ。
017 は M2 の受け入れ判定で人間から出た要望（L54）なので、番号は後ろだが M3 の先頭に置く。
**実際に触って出てきた要望を、計画の後ろに回さない。**

## 完了タスク

- 001-walking-skeleton（PR #1、レビュー往復2回）
- 002-design-tokens-and-ui（PR #3、レビュー往復2回）
- 003-auth-google（PR #5、実機確認2026-08-29完了。人間の受け入れ確認済み）
- 004-couple-and-invite（PR #9、実機確認2026-08-29完了。人間の受け入れ確認済み）
- 005-authorization-middleware（PR #19、Rレビュー往復2回。人間の受け入れ確認済み）
- 006-post-api（PR #33、Rレビュー往復1回・必須修正なしで受け入れ。mainへsquash merge済み、ブランチも削除済み）
- 007-image-upload（PR #41、Rレビュー往復1回・必須修正なしで受け入れ。実機確認
  2026-08-29完了〈署名なし拒否・期限切れ失効・削除反映・Content-Type往復〉。
  Rの最終確認済み。`env.BUCKET`バインディング経由の確認のみL34へ持ち越し）
- 008-timeline-ui（PR #47〈本体〉・PR #68〈人間の実機確認記録・削除の画面結合テスト
  追加・`artifacts/008/review.md`〉、Rレビュー往復2回で受け入れ。mainへsquash merge済み。
  L38（スクリーンショット要件）はPR #67で撤回されたため未達ではない）
- 009-reactions（PR #59〈本体〉・PR #60〈GET経由書き込み拒否の明示、対応対象の
  High指摘は誤指摘と判明〉・PR #61〈compose画面レイアウト修正〉・PR #70
  〈`artifacts/009/review.md`〉、いずれもRの受け入れを得てmainへsquash merge済み。
  実機確認で見つかったちらつき不具合・compose画面のレイアウト崩れも修正済み。
  **M2最後のタスク。停止条件をすべて満たした**）

- 010-calendar-api（PR #86。Rレビュー往復1回目の必須修正（`yearsBefore`の矛盾）と
  L61（Aの判断: 存在しない日付は月末に寄せる。PR #87）を反映し、Rの受け入れを
  得てmainへsquash merge済み（ブランチも削除済み）。マージ前修正なし・再レビュー
  不要で受け入れられた。`artifacts/010/test-results.md`・`artifacts/010/review.md`参照。
  単体でのsecurity-auditor監査は必須対象外〈006・008と同じ扱い〉のため未実施。
  M3の他タスクとまとめて監査する）

- 011-calendar-ui（PR #89。Rの受け入れを得てmainへsquash merge済み（ブランチも
  削除済み）。**必須修正なし。**編集は射影後の表示日付ではなく登録日
  （`sourceDate`）を対象にする設計をRが高く評価。記録2件（R-36: 日付計算が
  apps/app/apps/apiの2箇所に分かれた件→L63でAへ判断依頼、R-37: 繰り返し記念日の
  削除は全年から消える件→`artifacts/011/manual-check.md`に追加）。
  `artifacts/011/test-results.md`・`artifacts/011/review.md`参照。単体での
  security-auditor監査は必須対象外〈006・008・010と同じ扱い〉のため未実施。
  M3の他タスクとまとめて監査する。**人間の実機確認は未実施**（認証必須画面のため
  Bは実機確認不可。L62として起票。M3受け入れでまとめて回収）

**M1（001〜005）完了。2026-08-29、人間の明示的な受け入れ確認を得た。**
**M2（006〜009）実装完了。2026-08-30、人間の受け入れ判定待ち。**

## 進行中タスク

（現在、実装が進行中のタスクは無い）

## 環境

| 項目 | 状態 |
|---|---|
| 作業フォルダ | `C:\Users\coco7\futary` |
| リポジトリ | `sarada7739/futary`（**Private**。016 で Public に切り替える。ADR-011） |
| 既定ブランチ | `main` |
| gh CLI | 2.98.0 認証済み（スコープ: repo / workflow / gist / read:org） |
| Cloudflare | 設定済み。D1 `futary-db`（`database_id: 37d32e5d-80a9-4bc9-bae4-e7019bebd883`。**リモートにも全マイグレーション適用済み**）、R2 `futary-images`（**CORS設定済み**、`http://localhost:8081`のPUT/GET許可）。`workers.dev`サブドメイン登録済み（`sarada7739.workers.dev`）。`wrangler dev --remote`使用可能（L34解決済み） |
| R2 APIトークン | **設定済み**（2026-08-29）。`.dev.vars`の`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`に実際の値が入っている（コミットしていない） |
| Google OAuth | **設定済み**（2026-08-29）。`.dev.vars` に実際のクライアントID/シークレットが入っている（コミットしていない） |

## 次の一手

1. ~~M2 の受け入れ判定を人間に依頼する~~ → **完了（2026-08-30）。受け入れられた。**
   L4 もハート1種のままで決定
2. ~~`fix/` で L59（画面の最大幅）を入れる~~ → **実装完了。** `Screen` が既定で
   `layout.maxWidth = 640` を適用し、外す画面だけ `unconstrained` で明示的に外す
   形にした。**認証必須画面のPC幅実機確認は017とまとめて後で回収する**
3. ~~017（画像の全画面表示）に着手する~~ → **Rの受け入れを得てmainへマージ済み
   （PR #80）。** 当たり判定バグをRに指摘され「どこでも閉じる」仕様に修正済み。
   **人間の実機確認（L59とまとめて依頼。Rが列挙した4項目）だけ残っている**
4. ~~`task/009-reactions`（PR #59）・`fix/reject-get-writes`（PR #60）・
   `fix/compose-image-preview-layout`（PR #61）のRレビュー対応~~ → 完了。3件とも
   Rの受け入れを得てmainへsquash merge済み
5. ~~`artifacts/009/review.md`の作成（L60）~~ → 完了（PR #70）
6. ~~`workers.dev`サブドメインを登録する~~ → 解決済み（L34。実は既に登録済みだった）
7. ~~次はM3本体、010（カレンダーAPI）に着手する~~ → **Rの受け入れを得てmainへ
   マージ済み（PR #86）。ブランチも削除済み。** `events`テーブル・`lib/date.ts`・
   `event.list/create/update/delete`を実装し、繰り返し記念日の射影
   （年またぎ・400日上限・3暦年に触れる窓・うるう年）をテストで証明した。
   レビュー中に見つかったL61（存在しない日付は月末に寄せる）もA判断のうえ解決済み
8. ~~`docs/sample/風景/`の用途~~ → **解決**（L55・L56）。014 のデモ投稿の写真として
   5枚を使う（`eHaCqEMx.jpg` は架空のブランド看板が写るため除外）。
   **014 の着手前に L55〈デモペアの構成〉の人間の判断が要る**
9. ~~010（PR `task/010-calendar-api`）のRレビューを待つ~~ → **完了。**
10. ~~次は011（カレンダー画面）に着手する~~ → **完了。Rの受け入れを得てmainへ
    マージ済み（PR #89）。ブランチも削除済み**
11. ~~011のRレビュー結果を待つ~~ → **完了。**`artifacts/011/review.md`に保存済み
12. **次はM3の012（統計カード）に着手する。** 着手前にL63（日付計算の置き場所。
    R-36）について、Aの判断が出ていればそれに従う。出ていなければ現状の
    重複のまま進めてよい（R-37同様、012着手を妨げるものではない）

## 未解決の論点

| # | 論点 | 影響 | 判断時期 |
|---|---|---|---|
| L1 | 公開ドメインを `*.workers.dev` にするか独自ドメインを取るか | LP の OGP・第一印象。転職アピールでは独自ドメインの方が印象が良い。003で `BETTER_AUTH_URL`/`TRUSTED_ORIGINS` を本番用に設定する際にも必要 | 015 の前 |
| ~~L2~~ | ~~ロゴのスクリプト体をどう用意するか~~ → **解決**（002） | | 解決済み |
| ~~L3~~ | ~~デモペアのシードデータに使う写真の入手先~~ → **解決**。人間が `docs/sample/プロフィール画像/`（人物2枚）と `docs/sample/透過素材/`（アイコン類4枚）を配置。**すべてAI生成画像で実在の人物ではない**ことを人間に確認済み。出自と用途の割り当ては `docs/sample/README.md` に記録した。014 では `packages/db/seed/README.md` からこれを参照する | | 解決済み |
| ~~L4~~ | ~~リアクションの種類を1種（ハート）にするか複数にするか~~ → **解決（2026-08-30）。ハート1種のままとする。** 人間が M2 の受け入れ判定と同時に決定した。009 は1種で実装済みで、R も受け入れている。**実際に触った上での判断**であり、これ以上の根拠は要らない。`reactions` テーブルは `kind` を持つため、必要になれば後から増やせる（`architecture.md` 4節）。**増やす理由が出てくるまで増やさない** | | 解決済み（2026-08-30） |
| L5 | `apps/api/wrangler.toml` に D1 の `database_id` が平文でコミットされている | Private の間は問題ないが、016 で Public に切り替える際は要確認 | 016 の前 |
| ~~L6~~ | ~~CORS が localhost 固定~~ → **解決**（003）。`TRUSTED_ORIGINS` 環境変数化 + `.dev.vars`/`wrangler secret` 経由に変更 | | 解決済み（003） |
| L7 | `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` に `miniflare@...-alpha` 等が入っている | 安定版が出たら除外リストから外す | 随時（急ぎではない） |
| ~~L8~~ | ~~`packages/ui` の `shadow.fab` が `architecture.md` 7節に無い新規トークン~~ → **解決**（PR #12）。`shadow.fab` を7節の表に追記した | | 解決済み（PR #12） |
| L9 | ネイティブの Google ログイン未対応。`futary://` を `TRUSTED_ORIGINS` に含めていないため経路自体が無効（fail-closed）。`@better-auth/expo` はセッショントークンをURLクエリに載せる実装で、Androidはカスタムスキームの衝突リスクがある（003監査 Medium指摘） | ネイティブ対応（実機ログイン）を始める前に、検証済みディープリンク（Universal Links/App Links）への切替か、リスク受容のADR化が必要 | ネイティブ対応タスクの前 |
| ~~L10~~ | ~~Better Authの`rateLimit`がmemoryストレージのまま~~ → **解決（004）**。招待コード用には Better Auth の `rateLimit` を流用せず、`invite_failures` テーブル（user_id + IP + created_at）による専用の実装にした。Better Auth自体のOAuthエンドポイント向けrateLimitは003のまま未変更（別の課題として残る） | | 解決済み（004。Better Auth側のmemory storageは別課題） |
| ~~L11~~ | ~~CI に `pnpm audit` / gitleaks / Dependabot が無い（003監査 Low指摘）~~ → **解決**（`fix/ci-security-checks`）。gitleaks-action（検出1件で赤）、`pnpm audit --audit-level=high`（`pnpm-workspace.yaml` の `auditConfig.ignoreGhsas` で L39 の2件を無視）＋全重大度の出力専用ステップ（**無視リストの影響を外せないことが判明。この出力は統制ではなく人間が読む材料と位置づけを変え、代わりに『無視項目が監査結果に現れなくなったら赤』という陳腐化検出を置いた**。PR #52）、Dependabot はリポジトリ設定でセキュリティ更新のみ有効化（`dependabot.yml` は作らない）。着手中に発見したhigh勧告未修正問題（旧L43。AのL39と重複のため統合済み）は無視リスト方式で解決 | | 解決済み（`fix/ci-security-checks`）。無視リストの再評価は016の前 |
| L12 | `apps/api/src/index.ts` に `app.onError` が無く、サーバ内部エラーに一意なIDが振られていない（003監査 Low指摘）。クライアントへの漏洩は無いことは確認済み | 障害追跡ができない | posts等、複雑な処理が増えるタスクで対応 |
| L13 | セキュリティヘッダ（CSP等）が未設定（003監査 Low指摘） | 要件7節未達 | Web配信・LP実装タスクで対応 |
| ~~L14~~ | ~~003で実際のGoogleログインが未検証（クライアント未入手のため人間判断で保留）~~ → **解決（2026-08-29）**。人間がクライアントを作成し、実機で全項目を確認した。実際のログイン成功（2アカウント）・D1への`user`/`account`レコード作成・リロード後のログイン状態維持・Cookie属性（`HttpOnly`/`SameSite=Lax`）・ログアウト導線・004のオンボーディング導線（ペア作成→招待コード発行→別アカウントで参加）を全て確認済み。実機確認中に発見したバグ2件はPR #22で修正済み。詳細は`artifacts/003/manual-check.md`の追記部分参照 | | 解決済み（2026-08-29） |
| ~~L15~~ | ~~`packages/ui` の `Button` に `secondary` バリアントを追加した（002は `primary`/`ghost` の2種）。`architecture.md` 未反映~~ → **解決**（PR #12）。7節に「ボタンのバリアント」節を新設し、primary/secondary/ghost の3種と用途を明記した | | 解決済み（PR #12） |
| L16 | ログイン画面の「ログイン」と「新しくはじめる」が同じ `handleGoogleSignIn` を呼ぶ。Google OAuthに新規/既存の区別が無い以上コードとしては正しいが、UIは別動作に見える（Rレビュー003 R-21で指摘） | 見た目と実際の挙動の齟齬 | 016の仕上げで文言・導線を再検討 |
| ~~L17~~ | ~~`conventions.md` 9節の見出しが過大表現~~ → **解決**。見出しを「違反が痕跡を残すようにする」に修正し、「検出できること・できないこと」の表を追加。自己申告であり意図的な詐称は見抜けないことを明記した | | 解決済み（Rの指摘） |
| ~~L18~~ | ~~A / R / B が単一の作業ツリーを共有している~~ → **解決**（PR #14）。git worktreeで役ごとに作業ディレクトリを分離した（`futary/`=B・`futary-A/`=A・`futary-R/`=R）。`main`はBの`futary/`が持つ。これによりconventions.md 9節の「Bに未コミットの作業がある間、Aは設計ドキュメントを変更しない」という制約が不要になり、Aはいつでも書ける | | 解決済み（PR #14） |
| ~~L19~~ | ~~squash merge により `Session:` トレーラーが `main` で失われる（実例 `a2f6eb2`）~~ → **解決**。`conventions.md` 7節に「マージ戦略」節を新設。squash を維持したうえで、マージ時に `--body` でトレーラーを明示的に書き込む手順と、マージ後の確認コマンドを規定。あわせて「1 PR = 1 役」と、その例外を作らずに済ませる手順（判断はメッセージで運び、ドキュメントは A 単独の PR で運ぶ）を9節に追加 | | 解決済み（Rの指摘） |
| ~~L20~~ | ~~「1 PR = 1 役」と9節の例外「A の変更を独立したコミットに分けさせる」が両立しない~~ → **解決**。例外を廃止した。B が必要とするのは判断であってドキュメントのマージではないため、判断はメッセージで即時に運び、ドキュメントは A 単独の PR で並行して進める。ただし `/clear` した新セッションはメッセージを引き継がないため、着手前に main へマージすることを明記 | | 解決済み（Rの指摘） |
| L21 | `invite.issue` にレート制限が無く、満員のペアでもコードを発行できる。`invites`行の定期削除も無く単調増加する（004監査2回目 Low指摘） | 招待コードの母集団が無駄に膨らむ。ただし「画面遷移だけで無条件に発行される」設計上のバグ（004監査2回目 Medium指摘）を修正済みで、発行が明示操作に限られたため実害は小さい | トラフィックが増えてから再検討。急ぎではない |
| L22 | 001の歩くスケルトンで作られた `packages/db/migrations/0000_init.sql` がコメントのみで実行可能な文を持たず、`wrangler d1 migrations apply` が失敗する実在のバグがあった（004で発見） | → **解決（004）**。無害な `SELECT 1;` を1文追加した。**追記（Rの指摘R-24を受けて検証）**: 001の実装メモ（`docs/tasks/001-walking-skeleton.md` R-1対応）は「ローカルD1にも `0000_init.sql` として再適用済み」と記録しており、当時は成功していたはずだが、ファイル内容自体は001から004まで一切変更されていない（`git log -p --follow` で確認）。004実装中に、隔離した検証用ディレクトリで実際に `npx wrangler@4.126.0 d1 migrations apply DB --local` と `npx wrangler@4.124.0`（両方ともこのリポジトリが依存関係として持つバージョン）を素の状態で実行し、**どちらも同じ「internal error」で失敗する**ことを確認した。したがってこの004内での「本番のwranglerでも失敗する」という判断自体は裏付けが取れている。一方、001時点で何が違って成功したのかは、より古いwranglerバージョンでのビセクトが必要で、004の範囲では特定できなかった。エラーメッセージは `X [ERROR] internal error` と非常に目立つ形で出るため、001当時に本当に踏んでいれば見逃したとは考えにくく、当時の環境（wrangler/workerdのより古いバージョン、または`.wrangler/state`のD1エミュレータ実装差）で挙動が異なっていた可能性が高いと推測する | 解決済み（004）。原因の完全特定は持ち越し（急ぎではない） |
| L23 | `invite_failures` の掃除DELETEが `created_at` 単独インデックスを持たず全表走査になる（004監査2回目 Low指摘） | D1の行読み取り課金・遅延の増幅要因 | 要件6節の想定規模（2人×1日数投稿）では時期尚早。急ぎではない |
| ~~L24~~ | ~~`security-requirements.md` 4節が実装（user_id 10回/時間 + IP 50回/時間の二本立て）と食い違っていた~~ → **解決**（PR #10）。security-requirements.md 4節に「レート制限のキー」を新設し、user_id 10回/時間 + ip_address 50回/時間とその非対称の理由を明記。004 タスクファイル2箇所も揃えた | | 解決済み（PR #10） |
| ~~L25~~ | ~~IP が取得できない場合（ローカル開発等）に user_id 単独で判定する分岐が `security-requirements.md` 4節に書かれていない~~ → **解決**（PR #12）。4節に「IPが取得できない場合はuser_id単独で判定する。ip_addressにはNULLを入れ、固定の代用文字列を入れてはならない」を追記した | | 解決済み（PR #12） |
| ~~L26~~ | ~~`packages/ui` の `Button` が環境によっては1クリックで `onPress` を2回発火させる。呼び出し側（画面ごと）にガードを書く運用では、005で潰した「手続きごとに認可を書くと書き忘れる」と同じ構造になる~~ → **解決**（PR #27）。`conventions.md` 4節に、ガードは`Button`コンポーネント自身が持つ（呼び出し側に書かせない）・`useRef`で持つ（`useState`は同一tick内の2回目を取りこぼす）・副作用のある操作に生の`Pressable`を直接使わない、を追記した。実装（`Button`への組み込み、004の既存ボタンへの適用）は007以降で行う | | 規約解決済み（PR #27）。実装は007以降 |
| ~~L27~~ | ~~`apps/app` にテスト基盤が一切無い。UIバグが実機確認でしか検証できず退行しても気づけない~~ → **解決**（PR #27）。新しいタスク番号は作らず、クライアント側ロジックが最初に出る007（画像圧縮）でVitest + React Native Testing Libraryを導入する方針に決定。最低2件（画像圧縮ユーティリティ、`Button`の二重押下でonPressが1回しか走らないこと）を書く。`docs/tasks/007-image-upload.md`に前提節・完了条件・進捗を追記済み。PlaywrightのE2Eは認証が重いため014のデモ経路（未認証）で導入する方針 | | 解決済み（PR #27） |
| ~~L28~~ | ~~`docs/tasks/006-post-api.md` の完了条件が「005 の認可テスト**4件**」を指しているが、恒久基準（`security-requirements.md` 3節、PR #17で5件に更新済み）は**5件**~~ → **解決**（PR #35）。全タスクファイルを走査した結果、件数を書いていたのは006だけだったと判明。006の記述を件数抜き（`security-requirements.md` 3節を指すだけ）に訂正し、`conventions.md` 9節に「件数・項目数は出典側にだけ置く。引用側に書かない」を規約として追加した | | 解決済み（PR #35） |
| ~~L29~~ | ~~`apps/api/src/procedures/base.ts` の `writeProcedure` の戻り値型 `CoupleContext` が union のままで、readonly を実行時に弾いた後も `userId` が型上 `string \| null` のまま絞り込まれない~~ → **解決**（PR #37）。`writeProcedure` の OutContext を `Extract<CoupleContext, {mode: "member"}>` に変更し、`post.create` にあった到達不能な `if (userId === null) throw ...` を削除した。AがB案（`fix/`対応）を支持し、Rの受け入れを得てmainへマージ済み | | 解決済み（PR #37） |
| ~~L30~~ | ~~投稿の本文・画像がどちらも空の投稿を作成できてしまう（`post.create` に下限が無い）~~ → **解決**（PR #35）。「本文か画像のどちらかは必須」を要件化（`requirements.md` 4節）。006の時点では画像が無く下限を置けなかったため、画像が入る007で弾く形に揃える（`architecture.md` 5節・`docs/tasks/007-image-upload.md`に実装項目を追加済み。空白のみの本文も空として扱い、両方空・空白のみの2ケースをテストする） | | 解決済み（PR #35。実装は007） |
| L31 | `post.uploadUrl`にレート制限が無く、`post.create`を呼ばずにR2へアップロードだけを繰り返すと無参照オブジェクトが際限なく作れる（007 security-auditor Medium指摘）。誰でも到達可能（`couple.create`は`authedProcedure`のみ）で、金銭コスト・ストレージ増大につながる。機密性には影響しない | 016前のコスト管理・運用面。放置するとR2の課金が投稿数に対して不自然に増える | 016の前、またはトラフィックが増えた時点で再検討。`invite.accept`のレート制限の仕組み（`invite_failures`と同型）を流用できる。無参照オブジェクトの定期回収ジョブも未実装（`architecture.md`6節でMVP外と明記済み） |
| ~~L32~~ | ~~007でR2のS3互換API認証情報（`R2_ACCOUNT_ID`等）が未設定のため、署名なしアクセスの拒否確認・実際のアップロード実機確認が未実施~~ → **解決（2026-08-29）**。人間がR2 APIトークンを発行し`.dev.vars`に設定した後、実クラウドR2に対して確認した。署名付きPUT成功→署名なしGETは`400`で拒否→署名付きGETは成功しサイズ一致→期限切れGETは`403`で拒否→削除後は`404`、という一連の流れを確認済み（`artifacts/007/manual-check.md`）。**Rレビュー指摘を受けて追加確認**: 署名付きPUT URLはContent-Typeを署名で強制できないため、`post.create`の`head.httpMetadata?.contentType`検証が機能するには「クライアントがヘッダを送る」「R2がそれを保持する」の両方が必要。`apps/app/lib/image.ts`と同じ形でPUTし、署名付きGETのレスポンスヘッダで`content-type: image/jpeg`が返ることを確認し、両方揃っていることを実証した（Rが「結果がimage/jpegならそのまま完了タスクへ移してよい」と判定）。`env.BUCKET`バインディング経由（`wrangler dev --remote`が必要）の確認のみL34へ持ち越し | 完了条件を実機で満たした | 解決済み（2026-08-29）。007は「完了タスク」に移動済み |
| L34 | このCloudflareアカウントは`workers.dev`サブドメインが未登録のため、`wrangler dev --remote`が実行できない（007の実機確認中に発覚）。新しい`experimental_remote`（バインディング単位のリモート接続）もwrangler 4.126.0/4.127.1では未対応の設定項目として無視され、Workerランタイムがクラッシュする | `env.BUCKET`等のWorkersバインディングを実クラウドに向けたローカル開発・確認が一切できない。**016（公開）では必ず必要になる**（Rの指摘。デプロイ時に初めて気づくと止まる）。007で未確認のまま残った`env.BUCKET`経由の実クラウド動作確認（`post.create`のhead確認・`post.delete`のR2削除）もここにぶら下げる | **016の前**。人間がCloudflareダッシュボード（`https://dash.cloudflare.com/d08a3c92a0ca2b448831a612221af692/workers/onboarding`）で`workers.dev`サブドメインを登録する。登録後、`.claude/launch.json`の`api-dev-remote`設定（007で追加済み）で`wrangler dev --remote`を試し、`env.BUCKET`経由の確認もまとめて行う |
| L33 | R2のS3互換API認証情報が未設定の状態で画像付き投稿が1件でもあると、`r2-signed-url.ts`の`clientFor`が署名鍵未設定で例外を投げるため`post.list`**全体**が500になる（画像だけ欠落させる設計にはしていない。007 Rレビュー記録依頼） | fail-closedとして筋は通っており、デプロイ時の設定漏れに気づきやすい利点もあるとRは評価。画像の無い投稿しか無い開発初期は顕在化しない | 対応不要と判断済み（記録のみ）。将来「画像だけ表示しない」形に緩めるかは、実際に運用で困った時に再検討 |
| L35 | 投稿カードに必要な投稿者名・アバターが投稿スキーマに無かった（006 は `authorId` のみ、`me.get` は自分の情報しか返さない）。008 着手時に B が発見 | → **解決（008 で対応）**。`post.list`/`post.create` のレスポンスに `authorName`/`authorImage` を追加する。`architecture.md` 5節に設計を追記した。LEFT JOIN・両方 null 許容・`authorImage` は Google の外部URL（CSP の `img-src` 許可が要る。L13 に紐づく）。**A が最初に書いた「`author_id` は外部キーを持たない」という理由付けは誤りで、B の実測で訂正済み**（FK は存在する。投稿者が引けない状態は現在到達不能）。LEFT JOIN と null 許容は維持するが、根拠を「将来 `ON DELETE` が変わったときの壊れ方が INNER JOIN の方が悪い」に置き換えた。到達不能な備えであることを明記し、達成不能だった完了条件（「`user` 行が無くても投稿が落ちない」テスト）は削除した | 解決済み（設計はA、実装は008。理由付けの訂正あり） |
| L36 | 008 の完了条件が「E2Eテスト（ログイン→投稿→一覧に現れる）」を要求していたが、007 で「Playwright は認証が重いので 014 の未認証デモ経路で導入する」と決めていた。008 は 007 より前に書かれており、決定が引用側に反映されていなかった。さらに `conventions.md` 6節は E2E が「ログイン→投稿→リアクション→デモ閲覧」を覆うと書いており、**実際には作らない保証を恒久ドキュメントが主張していた** | → **解決**。008 の完了条件を画面結合テスト（RNTL + oRPC モック）に置き換え、`conventions.md` 6節の E2E を「未認証のデモ閲覧経路のみ」に訂正。認証を伴う導線は人間の実機確認で担保すると明記した。モックはサーバとの契約を検証しないことも書いた | 解決済み |
| L37 | `posts.author_id` は `user(id)` への外部キーを `ON DELETE no action` で持つ（008 で B が実測確認。D1 が実際に強制し、`PRAGMA foreign_keys = OFF` も無視される）。このため**将来アカウント削除機能を作ると、投稿が1件でも残っているユーザーの削除が DB エラーで失敗する** | 削除フローの設計時に、投稿の扱い（連鎖削除・匿名化・`ON DELETE` の変更）を先に決める必要がある。想定より安全側に倒れているが、気づかないとリリース直前に詰まる | アカウント削除機能を設計するとき。MVP スコープ外なので急ぎではない |
| ~~L38~~ | ~~008 の完了条件のうち `artifacts/008/` のスクリーンショットが未取得~~ → **解決。要件そのものを撤回した。** 人間が「面倒なので撮らない」と判断。機能の確認自体は完了しており（`wrangler dev --remote` でログインし、タイムライン表示・投稿作成・削除・リアクションを実際に操作して確認済み）、省略されたのは画像の保存だけである。あわせて実績を確認したところ、**UI を含む4タスクのうち撮れたのは 002 だけ**（001 は保存手段なし、003 はブラウザペイン不可、008 は人間の判断）で、**4回中3回が例外で通っていた**。毎回例外で通る要件は統制ではないため、`conventions.md` 8節でタスク単位のスクリーンショットを廃止し、015（LP 素材）と 016（本番証跡）に集約した | | 解決済み（要件を撤回） |
| L39 | **`@better-auth/expo` が `apps/api`（デプロイされる Worker）の本番依存になっており、Expo のツールチェーン一式（`@expo/cli` → `react-native` → `metro`）を依存グラフに引き込んでいる。** これが `pnpm audit --prod` でも high 2件（`image-size`）が消えない直接の原因（L11 で実測確認。B が着手前に発見しAへ報告、対応方針はAが決定） | Worker の依存グラフが実際にバンドルされるものより大幅に広い。監査の精度が落ち、無視リストを持つ必要が生まれている | **016 の前。** サーバ側の Better Auth に `@better-auth/expo` が本当に必要か確認する。不要なら high 2件は消え、無視リストを空にできる。必要なら、なぜ必要かを記録する |
| L44 | FAB（`packages/ui/assets/fab-plus.png`）の円の色が画像に焼き込まれている（実測 `#F4858C`）。トークン `primary`（`#F5868D`）とは1/チャンネル差があり視認できないが、`primary` を変えても FAB は追従しない（008 Rレビュー R-26） | ピンクの円＋白の＋という多色画像のため `tintColor` が使えず妥当な判断だが、タブアイコン（`tintColor` で追従）との非対称が生まれた。002の「色をトークンに集約する」方針が部分的に巻き戻っている | 記録のみ。デザイントークンを変更するタスクが出たときに思い出すこと |
| L45 | `apps/api/src/procedures/post.ts` の `postCreate` が `context.user!`（非null表明）を使っている。`CoupleContext` の `mode:"member"` variant が `userId` しか持たず `user` オブジェクト自体を持たないための回避策で、PR #37 で `writeProcedure` の戻り値型を絞り込んだのと同型の問題（008 Rレビュー R-27） | 009・010 で投稿者情報が必要になるたびに同じ表明が繰り返される。member variant に `user` そのものを載せれば型で消せる | 急ぎではない（アサーション自体は健全）。`CoupleContext`/`base.ts` を触るタスクで合わせて検討 |
| L46 | `post.list` の署名付きGET URL（有効期限1時間）が期限切れのまま表示される事故は、`refetchInterval: 60秒` と TanStack Query の既定 `staleTime: 0` の組み合わせでたまたま防がれている。**意図して置いた保証ではない**（008 Rレビュー R-28） | 将来 `apps/app/lib/query.ts` の `staleTime` を伸ばす変更をすると、期限切れURLでの画像読み込み失敗が起きうる | 記録のみ。`lib/query.ts` に注意コメントを足すと親切（急ぎではない） |
| ~~L47~~ | ~~squash merge で生成される `main` 上のマージコミット自体に `Session:` トレーラーが付かない（008 Rレビュー R-29）~~ → **前提が誤っていた。** A が確認したところ、指摘された `f7bcea2`（「Merge branch 'main' into task/008-timeline-ui」）は**`main` に載っていない**。squash merge が作業ブランチ側のマージコミットを畳んでいるため。`main` の全コミットは単一親で `Session:` を持つ（`git log origin/main --format='%h %(trailers:key=Session,valueonly)' \| awk 'NF<2'` が空であることを確認）。ただし規約の文言が「全てのコミットメッセージ」で対象が曖昧だったのは事実なので、`conventions.md` 9節を「`main` に載る全てのコミット」に限定し、作業ブランチ途中のコミット・git が自動生成するマージコミット・Dependabot には求めないことを明記した。検証コマンドも添えた | | 解決済み（PR #52） |
| L40 | `pnpm audit --ignore-unfixable` は**フィルタではなく `pnpm-workspace.yaml` を書き換えるコマンド**である（pnpm 11.24.0 で A が実測。`auditConfig.ignoreGhsas` に理由コメント無しで自動追記され、2回目以降は静かになる） | 「修正版が無いものは赤にしない」をフラグ1つで表現できるように見えるが、実際には無視リストを無言で自動生成する。CI で使えば実行のたびに作業ツリーが書き換わる | **対応済み（記録のみ）。** `security-requirements.md` 9節に「CI・スクリプト・手元の確認、いずれでも使わない」と明記した |
| L48 | `gitleaks-action@v2` は `push`/`pull_request` イベントでは**その回のコミットだけ**を走査する。`fetch-depth: 0` は差分計算用で、全履歴の走査ではない。リポジトリ全体を見るのは `schedule`/`workflow_dispatch` のときだけ（L11 Rレビュー R-30） | 016完了条件の「gitleaksが緑」は差分走査が緑という意味でしかなく、「履歴のどこにも秘密が無い」ことは証明しない。003監査時にも同じ穴（`git log --all` の走査ができない）が指摘されていた | `security-requirements.md` 9節に既に「公開前に履歴全体を1度走査する」規定はあるが、実行方法（`workflow_dispatch`か`schedule`を1本足す）は未実装。016の前に対応 |
| L49 | Dependabotのセキュリティ更新のみ有効化（`vulnerability-alerts`・`automated-security-fixes`）はリポジトリ設定のAPI経由で行い、`dependabot.yml`を作らなかったため、**設定がリポジトリ内に痕跡を残さず、レビューやCIでは検証できない**（L11 Rレビュー R-31。実測: `gh api repos/{owner}/{repo}/vulnerability-alerts`→204、`gh api repos/{owner}/{repo}/automated-security-fixes`→`{"enabled":true,"paused":false}`で現在は有効と確認済み） | 誰かが無効化しても誰も気づけない | 016の確認手順に上記2つの`gh api`コマンドでの実測確認を追加する |
| L50 | `scripts/check-audit-ignore-staleness.mjs`の「判定を見送る」分岐（`metadata.vulnerabilities`が想定した形でないとき）は、将来pnpmのJSON出力形式が変わると恒久的に見送り続け、CIは緑のまま固定される可能性がある（L11 Rレビュー R-34）。「放置すると赤くなる」ために作った陳腐化検出に、静かに緑で居座れる経路がある | ログには「判定を見送ります」と出るが、Aが陳腐化検出に切り替えた理由自体が「誰もCIログを読まないから」だったため、この経路もログだけでは気づかれない | 016の再評価項目に「陳腐化検出が実際に判定を行っているか（見送りが常態化していないか）」の確認を追加する |
| L51 | 008のPR #47受け入れ・マージ後、B自身が「009-reactions（次に着手する。着手可否をAに確認中——Aは当初『Rが008をまだ見ていない』ことを理由に保留を指示していたが、実際には008・L11ともRの受け入れ・マージが完了済みのため、状況をAへ再連絡した）」とworklogに書いた際、L11のPR #54の`process.exit(0)`修正を「バグ発見」と報告したが、Rの確認では当該箇所はバックアップ作成より前にあり、その時点では復元をスキップする経路は成立していなかった（L11 Rレビュー R-35） | 「潜在的な危険パターンを先に潰した」が正確な表現で、「バグを発見した」は少し強い。満たせないものを満たしたことにしないのと同じ精度で、自己申告が過小な方向に外れるのも避けるべき | 記録のみ。今後同種の報告をする際の表現の精度に活かす |
| L58 | **M2（008 タイムライン・009 リアクション）は視覚検証なしで締まった。** R は 008・009 の視覚的な結果を一度も見ていない（R 自身の申告）。人間は実機で操作して動作を確認しているが、**独立した目でレイアウトを見る工程は通っていない**。L38 でタスク単位のスクリーンショットを撤回した結果である | 非難ではなく、後から M2 の品質を問われたときに**何が確認され何が確認されなかったかを言えるようにする**ための記録。002 では R が画像からロゴの背景色の不一致（R-7）を見つけており、この種の検出はテキストの記録からは出ない | **016 の全体監査で回収する。** 016 のスクリーンショット撮影を「証跡かつ初回の視覚レビュー」と位置づけ、撮った画像を見てレイアウトの崩れ・色の逸脱を確認することをタスクファイルに明記済み |
| L59 | ~~画面の最大幅に制約が無い~~ → **解決（実装済み）。** `packages/ui`の`tokens.ts`に`layout.maxWidth = 640`を追加し、`Screen`が既定でこれを適用する形にした（`unconstrained`プロパティで明示的に外せる。既定では誰も外していない）。型チェック・lint・テストは緑、認証不要のサインイン画面でブラウザ実測（`getComputedStyle`で`maxWidth: 640px`確認）済み。**認証必須画面（タイムライン等）のPC幅実機確認は017とまとめて後で回収する**（`artifacts/fix-layout-maxwidth/manual-check.md`） | 写真と文章を読む画面で 1248px 幅は読みにくい。転職で読まれる想定のプロダクトとして、PC で開いた第一印象に直接効く | 解決済み（実装）。**視覚的な実機確認のみ017とまとめて持ち越し** |
| L60 | **R が「記録のみ」とした指摘がどこにも残らず消えていた。** B が対応した指摘だけがタスクファイルに残り、差し戻さなかった指摘は R のメッセージの中だけに存在して `/clear` で失われる（R の自己申告。A が `artifacts/` を走査して裏付け。**レビュー結果を保存したファイルは1つも無い**） | 対応しない指摘こそ「なぜ差し戻さなかったか」を後から読み返す価値がある。対応したものはコードに現れるが、しないものは何にも現れない。L59 は実際にこれで30タスク失われた | → **解決**。`conventions.md` 8節に「R のレビュー結果を `artifacts/NNN/review.md` に B が一字一句そのまま保存する」を規定。論点表に上げるのはタスクを跨いで効くものだけとし、判断は R が行う |
| ~~L52~~ | ~~oRPCの`RPCHandler`がHTTPメソッドを見ないため、全ての書き込み手続きが`GET`で実行できる（009 M2まとめ監査 High指摘）~~ → **【訂正・誤指摘と判明】**。Rレビューで、`@orpc/server`の`RPCHandler`が既定で`StrictGetMethodPlugin`を自動登録しており、GET経由の手続き実行は元々拒否されていたと判明した（`@orpc/server/dist/adapters/fetch/index.mjs`で確認）。**CSRFの脆弱性は存在しなかった。** `fix/reject-get-writes`で貼った実測（`GET .../couple/get: 405`）は修正前から一貫して正しく、誤っていたのはその解釈の方だった。コード・回帰テストはライブラリの既定に依存しない防御としてそのまま残す（Rの判断）。詳細は`docs/security-report.md`の該当エントリ参照 | | 解決済み（誤指摘と判明・記述訂正済み。`fix/reject-get-writes`PR #60で対応） |
| ~~L53~~ | ~~oRPCの`encode`が`Cache-Control: no-store`等のレスポンスヘッダを付けない（009 M2まとめ監査 Info指摘）。L52（GETが通る）と組み合わさると…~~ → **前提のL52が誤指摘だったため、この指摘も成立しない**（GET経由の到達自体が元々無い）。`Cache-Control: no-store`自体の要否は本件と切り離した話であり、緊急性はない | | 前提が崩れたため対応不要（記録のみ）。`Cache-Control`自体を足すかは016前に任意で検討 |
| ~~L54~~ | ~~008・009の実機確認中、人間から「投稿カードの画像をタップしたら（Xのように）全画面で拡大表示したい」という新規UI機能の要望が出た~~ → **解決**。Aが`docs/tasks/017-image-lightbox.md`として起票し、PR #62で**M3の先頭**に置いた。タスク番号は識別子であって順序ではないことをマイルストーン表に明記した（実機で出てきた要望を計画の後ろに回さない）。「Xのように」を額面どおり取らず、ピンチズーム・スワイプで閉じる・画像間のスワイプ移動の3つは「やらないこと」として明示的に外した（元画像が長辺1600px/品質0.8〈007〉のため深い拡大は粗くなるだけ、1投稿1画像のため移動先が無い、等）。実装は`react-native`の`Modal`を使い、expo-routerのモーダルルートにはしない方針（`post.list`が返す署名付きGET URLをそのまま渡す。投稿IDから引き直すルートにすると期限切れURLを掴む経路を新設してしまう。L46と同じ形）。新しいAPI手続きは作らない（005の認可テストは変化しない想定）。閉じる導線は3つ（画像外タップ・×ボタン・戻る/Esc）、読み込み失敗時も閉じられることを確認観点に含めた | | 解決済み（Aの起票。017としてM3先頭。実装はBが017着手時に行う） |
| L57 | `conventions.md` 9節の「競合したときの正解は**常に**両方残す」が、`state.md` の論点テーブル（リストなので和集合が正しい）を想定した規則なのに、**文言上あらゆる共有ファイルに読める**状態だった。PR #59 と #60 が同じ誤指摘の訂正を `docs/security-report.md` に別々の形で書いており、両方残すと同じ内容が2箇所に残る（R の指摘） | 記録ファイルで「両方残す」を適用すると、同じ事実の重複が増え続ける。security-report.md では訂正の所在が分散し、元の行だけを読んだ人が実在しない脆弱性を追う | → **解決**。9節の適用範囲を `state.md` の論点テーブルに限定し、一般則（**別々の事実なら両方残す／同じ事実の別表現なら正典を決めて1つにする**）を追加。`security-report.md` の訂正は元の行に打ち消し線で書き、生の監査出力は書き換えないことも規定。`security-requirements.md` 10節の突き合わせ条件も「完全一致」から「生の内容が転記側にすべて含まれている」に直した。個別の対応は R の提案（#59 を先にマージして正典とし、#60 はリベース時に重複を落とす）どおりで正しい |
| L55 | **デモペアの構成が素材と合っていない。** アバターは女性2人（`プロフィール画像/woman1.jpg`・`woman2.jpg`）だが、`風景/` の写真6枚のうち4枚には**男女2人**が写っている（A が全6枚を確認）。そのまま組み合わせるとデモのタイムラインでアバターと写真の人物が食い違う | デモは公開前提で、面接官が最初に見る画面になる。人物の食い違いは作り込みの粗さとして目に付く | **014 の着手前。** A の推奨は「デモペアを男女にする」（素材の多数派と一致し、必要なのは男性ポートレート1枚の追加生成だけ）。人物なしの2枚だけ使う案は、写真が2枚しか無くなるため弱い。**人間の判断待ち** |
| L56 | `docs/sample/風景/eHaCqEMx.jpg` に**架空のブランド看板「未来はここから始まる ⊕ FUTARU」**が写り込んでいる。AI が生成した架空の標識だが、閲覧者には実在の店舗・企業の看板に見える。`FUTARU` が実在の商標でないことを確認できていない | デモは 016 で Public になる。確認できないものを公開物に載せない | **対応済み。** `docs/sample/README.md` の「使わないもの」に理由付きで記録し、014 の割り当てからも外した。他に5枚あるので使わずに済む |
| ~~L61~~ | ~~`apps/api/src/lib/date.ts` の `monthsBefore` は、日が月末を超える場合（例: `2026-03-31` の1ヶ月前）に JS の `Date` の自動繰り上げに任せており、`2026-03-03` を返す（月末〈2/28〉に寄せない）〜利用者からは誤りに見えうる（010 Rレビュー指摘）~~ → **解決（2026-08-30）。月末に寄せる。** Aが「存在しない日付は、その月の末日に寄せる」を一般則として`architecture.md` 5節に新設した（PR #87）。010のうるう日規則（`projectMonthDay`）は「別の問題」ではなく**同じ問題**だった（`2028-02-29`の1年前が素の`Date`だと`2027-03-01`になり、射影規則の`02-28`と正面から矛盾する）。`projectMonthDay`を一般化（`daysInMonth`でクランプ）し、`monthsBefore`/`yearsBefore`ともこれを通す形に統一した。テストも期待値を差し替えて反映済み（178→181件） | | 解決済み（2026-08-30。PR #87・010の中で反映） |

| L62 | 011（カレンダーUI）はコード側完了だが、画面が認証必須（`Stack.Protected guard={hasCouple}`）のためB（自動化）は実機確認ができない。自動テスト（画面結合8件）はoRPCクライアントをモックしており、サーバとの契約・実際の見た目・スマホ幅での窮屈さは未検証 | 前月・翌月ナビゲーション、イベントのD1への実反映、種別マーカーの色の見分けやすさ、繰り返し記念日の実データでの表示（削除時に全年から消えることが分かるか。R-37）が未確認のままM3の他タスクへ進むことになる | **M3の受け入れでまとめて回収する**（017のL59とまとめる回収と同じ形）。確認項目は`artifacts/011/manual-check.md`参照 |
| L64 | **表示用の日付整形が端末のタイムゾーンで行われている。** `apps/app/app/(onboarding)/invite.tsx`（招待コードの有効期限）と `apps/app/components/post-card.tsx`（投稿の日付）が `toLocaleString("ja-JP")` / `toLocaleDateString("ja-JP")` を `timeZone` 指定なしで呼んでいる。**ロケールは ja-JP でも、タイムゾーンは端末のもの**が使われる | このアプリは JST 固定（`conventions.md` 6節）。端末が別のタイムゾーンにあると**投稿の日付が1日ずれて表示される。** 利用者2人が日本に居る間は顕在化しないが、014 のデモは公開前提であり、**海外から見た面接官には別の日付が見える** | → **対応方針決定。** 整形も `packages/date` に置き、JST を明示する（`architecture.md` 2節）。`new Date(...)` を外で書かせない ESLint 規則がこの2箇所も自動的に拾うため、L63 の移行の中で片付く |
| ~~L63~~ | ~~日付計算が `apps/app/lib/calendar.ts` と `apps/api/src/lib/date.ts` の2箇所に分かれている~~ → **解決。`packages/date` を新設して寄せる**（`architecture.md` 2節）。危ないのは **`todayJst` が両側に同名で存在すること**で、ずれるとカレンダーが強調する「今日」と `memory.get` が見る「今日」が別の日になる。加えて「存在しない日付は月末に寄せる」（L61）の実装が2箇所にあれば**規則も2つになりうる**。`new Date()` / `Date.now()` を `packages/date` の外で書かないことを ESLint で縛る。`packages/contract` には入れない（型の単一の源であって道具箱ではない）。**R の「012・013 は両側とも日付計算を使う」は言い過ぎで、両タスクの日付計算はサーバ側**（タスクファイルで確認）。ただし `todayJst` の二重定義は現に存在するため、結論は変わらない | | 解決済み（設計はA。実装は `fix/` で 012 の前に行う） |

## 決まっていることの要約

| 項目 | 決定 |
|---|---|
| データモデル | 最初から複数ペア対応（couple 単位） |
| フロント | Expo Router + React Native Web 単一コードベース、LP は素のHTML別置き |
| 認証 | Google OAuth のみ |
| ペア参加 | 6桁の招待コード（有効期限24時間） |
| 画像 | 1投稿1枚。クライアント側で圧縮し R2 へ直アップロード |
| 通知 | 作らない。ポーリングで代替 |
| カレンダー | 記念日・予定・会った日を `events` 1テーブルに統合 |
| デモ | 未認証・閲覧専用。書き込みはサーバ側で全拒否 |
| 期間 | 2〜4週間で公開 |

判断の理由は `docs/decisions.md`。
