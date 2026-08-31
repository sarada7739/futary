# 現在地

> セッション開始直後・コンテキスト圧縮直後は、まずこのファイルを読む。
> ファイル変更を伴う作業の完了時は、必ずこのファイルを更新する。

**最終更新**: 2026-08-31 / セッションB（futary-f2）。**016（仕上げと公開）の
「デプロイ前にできる」実装完了・PR #172、Rが内容を受け入れ済み。
ただし**マージは保留中**——Rが明示的に「コードの受け入れ」と「マージしてよい」を
分け、`production`環境へのRequired reviewers設定（人間にしかできないGitHubの
リポジトリ設定）が済むまでマージしないよう指示した。理由: `deploy.yml`は
`push: main`で走るため、**このPRをマージした瞬間が最初の自動デプロイになる。**
Required reviewersが無いまま本番D1へのマイグレーション適用が無条件に走る
（`architecture.md`6節「適用には人間の許可を取る」と矛盾する）。**次にこの
セッションを開くセッションは、人間がRequired reviewersを設定したことを
確認してからPR #172をマージすること。マージ前に確認せず進めない。**

015はPR #170、Rの受け入れを得てmainへsquash merge済み（`76ef4dd`）。
014は完全に閉じている（PR #165。`7aef87d`）。人間は就寝中のまま。A経由で
「014→015→016のデプロイ前まで、人間の確認を挟まず止まらずに進めてほしい
（実機確認はまとめて後で）」との指示を受けて進めてきたが、**ここが実際に
人間の手を要する最初の分岐点。**PR #172のマージ以降は全項目が人間パートで、
これ以上自動で進められる作業は無い。**公開ドメイン（論点L1）は未決のため
`*.workers.dev`で進めた。**

**016の実装内容**: `docs/tasks/016-release.md`「デプロイ前にできる」8項目を
すべて実施した（詳細は`artifacts/016/test-results.md`）。
- **3状態の補完**: Exploreエージェントで全13画面を調査し、profile.tsx
  （isLoading/isErrorを一切見ていなかった）・memory-card.tsx（3状態すべて
  `return null`）・stats-card.tsx（エラー時にカードごと消える）・_layout.tsx
  （認証済み利用者がcouple.getで通信エラーを受けると3つのguardが全てfalseに
  なり、`retry:false`のため自動再試行も無いまま空白画面で永久に止まる経路が
  実在した）を修正
- **エラー処理の統一**: `apps/api/src/lib/error-id.ts`をRPCHandlerの
  interceptorsに登録し、想定外の例外にのみUUIDを振ってサーバログに詳細を、
  クライアントにはIDのみ返す形にした。oRPCの既定動作が既にスタックトレース等を
  漏らさないことは実装まで読んで確認済み（security-auditor指摘Low-7）
- **デプロイワークフロー**（`.github/workflows/deploy.yml`。ファイルのみ、
  走らせていない）: gitleaks・pnpm audit（high以上）のゲートも追加
  （デプロイ経路がCIと独立して走るため。security-auditor指摘Medium-1）
- **gitleaks履歴全体走査**: この環境に無かったためwinget経由で導入し、
  215コミット・約3.48MBを走査して検出ゼロ
- **pnpm.auditConfig.ignoreGhsas再評価**: 2件（image-size、Metro経由）を
  GitHub Advisory APIで再確認。修正版は依然存在しない（`patched: null`）
- **security-auditorの全体監査（T1〜T8）**: リポジトリ全体（初めての通し監査）。
  **High以上0件。**Medium4件・Low9件のうち、コードで直せるもの
  （R2 CORSのファイル化・Better AuthのIP解決・セキュリティヘッダ・
  GitHub Actionsのpermissions明示とSHA固定・Cookie属性テスト・
  post.createのtrimmedBody統一）は対応済み。リポジトリ外の設定に依存する
  もの（R2バケットの非公開確認）は`docs/tasks/016-release.md`の人間パートへ
  追加。詳細は`docs/security-report.md`・`artifacts/016/security-audit-raw.md`
- **README**: `.dev.vars`セットアップ手順（従来欠落）・技術構成・開発体制
  （Maker-Checker）・公開URL欄を追加
- **E2E**（`e2e/demo-guest.spec.ts`。Playwright新規導入）: 「デモを開く→
  閲覧できる→書き込みが拒否される」を自動化。CIには組み込んでいない
  （ブラウザインストールのコストのため）。実行結果1件成功

`pnpm -w test`（apps/app 152件・apps/api 303件）・`eslint .`・
`pnpm -r type-check`（`e2e/`含む）全て通過。

**PR #172のRレビュー対応（R-1〜R-3、3往復）**:
- **R-1（本番D1へのマイグレーション適用に、許可も事前確認も無い）**:
  (1) `0013_event_repeat_yearly_check.sql`が要求する人間向けの事前確認
  （CHECK制約違反行が無いか数える）を`scripts/check-remote-migration-preconditions.mjs`
  として自動化し、`db:migrate:remote`の直前に実行するようdeploy.ymlに追加。
  初版は結果を読めなかった場合も「0件」と解釈するfail-open（`?? []`・`?? 0`の
  2段重ね）になっており、Rの指摘で全ての想定外の応答形状を例外にする
  fail-closedへ書き直した（ローカルD1で正常系・異常系の両方を確認）。
  (2) `production`環境へのRequired reviewers設定はGitHubのリポジトリ設定で
  コードでは設定できないため人間パートへ追加。**この設定は「デプロイの前」
  ではなく「PR #172のマージ前」に必要**（マージ自体が最初のpush:mainになる
  ため）であることを、Rから2回目の指摘を受けて`docs/tasks/016-release.md`・
  `deploy.yml`の両方に明記した
- **R-2（deploy.ymlの独立検証がci.ymlの部分集合）**: ci.ymlにあって
  deploy.ymlに無かった2つ（無視リストの陳腐化検出・drizzleスナップショット/
  スキーマのずれ検出）を追加し、`.dev.vars`の作り方もci.ymlと同じファイル
  方式に統一
- **R-3（014の受容理由を016が反証したまま残っている）**: `root-route.test.ts`・
  `_layout.tsx`の「再試行でじきに解消する」という誤った記述を、実際は
  `retry:false`で自動再試行が無いことを踏まえて訂正（`resolveRootRoute`の
  期待値自体は変更なし）

**次のセッションがまずやること**: 人間が起きて`production`環境に
Required reviewersを設定したことを確認してから、PR #172をマージする
（CI green確認 → `gh pr merge --squash --delete-branch`。R-1参照）。
マージ後、`docs/tasks/016-release.md`の「人間の手が要る」表
（Required reviewers・Cloudflareトークン・`wrangler secret`本番設定
〈`BETTER_AUTH_URL`/`TRUSTED_ORIGINS`を本番の単一オリジンに。#170で
特定した403の本体〉・OAuth本番リダイレクトURI・R2 CORS本番オリジン・
R2バケット非公開確認・本番シード投入・Public切り替え・ブランチ保護・
デプロイ実行）を人間へまとめて依頼する。それ以降（本番スクリーンショット・
iPhone Safari実機確認・ログインが200で完了することの確認等）はデプロイ後。

**PR #170のRレビュー対応（R-1〜R-3）**: R-1（`auth-client.ts`の`baseURL`が
遅延評価でない件）は実機で「ログイン」ボタンを押しsign-in/socialが同一
オリジンへ飛ぶことを確認して解消。R-2（`EXPO_PUBLIC_API_ORIGIN`空文字上書きは
関数化だけで不要では）は、上書きを外した状態で再ビルド・バンドルをgrepし、
関数化の対策単独で再発防止できることを確認（空文字上書きは多層防御として
残す判断。Metroがなぜここでは値をインライン化しないのかの内部機構は
未確認のまま）。R-3（コメントの正確性）はコメントを実測経緯どおりに
書き直した。あわせてsecurity-auditorのMedium/Low指摘（R2 CSPワイルドカード
→実アカウントID固定、`blob:`・Googleアバターホスト・`form-action`・HSTS追加、
インラインscriptハッシュの全HTML走査化、ローカル開発オリジン焼き込みの
再発防止チェック追加）も反映済み。詳細は`artifacts/015/test-results.md`。

**重大な発見（015で初めて顕在化）**: `apps/app/lib/api-origin.ts`が
`expo export --platform web`（`output: "static"`）のビルド時最適化により、
**本番の配布バンドルに`http://localhost:8787`を焼き込んでいた。**
モジュール直下の定数式が`typeof window`をビルド時に固定値へ畳み込まれる
ことが原因（実測でJSに定数として出現することを確認）。関数
（`getApiOrigin()`）に変更し、oRPCの`RPCLink`には遅延評価の関数を渡す形に
修正した。014・016のどのタスクでも見つからなかった不具合で、
`apps/app`を`expo start --web`（開発サーバー）でしか動かしておらず、
`expo export`（静的ビルド）を初めて実行した015で顕在化した
（詳細は`artifacts/015/test-results.md`）。

**015の実装内容**: `apps/landing/`（素のHTML/CSS。ADR-002）・
`scripts/build-public.mjs`（LPとアプリのWeb exportを`apps/api/public/`へ
合成するビルドスクリプト。CSPを含む`_headers`を生成）・
`apps/api/wrangler.toml`の`[assets]`設定（`run_worker_first`は`/api/*`のみ。
`/`と`/app/*`は静的アセットとして直接配信）。`apps/app`は動的セグメントを
持たないため、`web.output="static"`・`experiments.baseUrl="/app"`で
全26ルートが実ファイルとして書き出され、SPAフォールバックが不要という
設計にした。ローカルの`wrangler dev`に実ビルドを配信させ、`/`・`/app/*`・
`/api/*`すべてが正しく動くこと、CSPヘッダが付与されること、014のデモ体験が
このビルドでも正しく動くことを確認済み。

apps/app 143件→150件（+7。root-route.test.ts分。014マージ後の値）の
テストは変更なし（015は新規テストを追加していない。ビルド・設定・
バグ修正が中心のため）。型チェック・lint通過。security-auditorの監査は
実行中（結果は`artifacts/015/test-results.md`または`worklog.md`へ追記）。
**次はRへレビュー依頼したのち、Aの指示どおり016（デプロイ前）へ進む。**

## 015の実装詳細は `artifacts/015/test-results.md` を参照

## 014の実装内容（詳細。PR #165・マージ済み）

`docs/tasks/014-guest-demo.md`どおり実装した。着手前にAがPR #163でタスク
定義中の3箇所のズレ（`repeat_yearly`のCHECK未実装・`time`→`start_time`
改名漏れ・`anniversary_date`→`dating_date`改名漏れ）を直しており、それに
従って進めた。

**DBマイグレーション**（`0013_event_repeat_yearly_check.sql`）: `events`に
`events_repeat_yearly_check`を追加（`repeat_yearly=1`は`kind='anniversary'`
のときだけ許可。018で入れたつもりで実際には入っていなかった制約。Rが実測）。
`events`は他表からFK参照されない子テーブルのため、019の`couples`と違い
drizzle-kitの通常の「表を作り直す」手順がそのまま通った。生成SQLに
`CREATE INDEX`が2本入っていることを目視確認し、`schema-integrity.test.ts`・
`migration-existing-rows.test.ts`にケースを追加した。

**デモシード**（`packages/db/seed/demo.ts`・`run.ts`）: 固定ID
（`demo-couple`・`demo-user-yui`・`demo-user-ren`）でmeetup 94件・plan 6件
（未来日含む）・anniversary 4件・投稿43件（画像4件）・リアクション34件を
決定的に組み立てる（`packages/date`のみ使用。乱数なし）。`run.ts`が
`wrangler d1 execute`・`wrangler r2 object put`を直接呼んでD1・R2へ投入する
（`--local`は014、`--remote`は016で使う想定。同じロジックを使い回す）。
ローカルD1・R2へ実投入し、oRPCエンドポイントを未認証で叩いて動作を確認済み
（`stats.get`のdaysTogether・meetupDays、`memory.get`の1ヶ月前投稿、
`event.list`の混在表示、`post.create`のFORBIDDENなど。
`artifacts/014/test-results.md`参照）。2回連続実行の冪等性も確認済み。

**クライアント側**: `apps/app/lib/guest-mode.ts`（React Context）でゲスト
閲覧状態を管理し、サインイン画面の「ゲストではじめる」・常時デモバナー・
FAB/カレンダー「＋追加」/マイページ/投稿画面のログイン導線への差し替えを
実装した。**サーバ側の拒否が唯一の防御線**という方針は変えていない
（UI側は体験のためだけの措置）。

**security-auditorの監査**: High該当なし。Medium 3件・Low 4件、すべて
実装で対応済み（詳細は`artifacts/014/test-results.md`）。最も重かった指摘は
「シードの削除・R2上書きが`is_demo=1`を確認せずに固定IDだけで実行されており、
`DEMO_COUPLE_ID`が万一実在の非デモペアを指した場合に復旧不能な削除になる」
というもので、`run.ts`に`assertSafeToOverwrite()`を追加して対応し、実際に
非デモペアを装った状態を作って中断することを確認した。もう1つは、シード用に
選んだ風景写真5枚のうち1枚（旧`docs/sample/風景/Y5dn1UKP.jpg`）に実在しそうな
店名の看板が写り込んでいたため、使用する写真を4枚に減らした
（`docs/sample/README.md`に追記）。

**既知の制約（人間への報告事項）**: ゲストモードを抜けたあと、**ページを
再読み込みせずに**同じページ内でもう一度「ゲストではじめる」を押すと、
デモバナーだけ出て画面が遷移しないことがある（Expo Routerの
`Stack.Protected`が、guardが新しくtrueになったグループへの自動遷移を
サポートしていないため）。ページの再読み込みで復帰する。この検証環境
（Claude Code Browser pane）ではMetroへのWebSocket接続が不安定になり
実ブラウザでの再現性を確認しきれなかったため、**人間の実機（実際の
ブラウザ）で頻度・気づきやすさを確認してほしい**（`artifacts/014/
manual-check.md`）。気になるようならsessionStorage経由のフルリロード方式
（コメントに残した）で直せる。

apps/api 297件（+1）・apps/app 135件（+2）・packages/db 17件（新規）
すべて緑、型チェック・lint通過。**次はRへレビュー依頼。**その後、Aの指示
どおり015（ランディングページ）へ進む。

## 023の実装内容（詳細。PR #162・マージ済み）

`docs/tasks/023-anniversary-optional.md`どおり実装した。着手前に
**`ALTER TABLE couples DROP COLUMN`がD1で通るかをローカルD1で実測確認**
（「通るはずだ」で進めない。Aの指摘）。手順は
ADD COLUMN→値コピー→TRIGGER2本の作り直し→DROP COLUMNの順で、3番目を
飛ばすと4番目が`no such column`で落ちることも実測した上でこの順で進めた
（詳細はworklog参照）。

`couples.anniversary_date`（NOT NULL）を`dating_date`（NULL許容）へ改名
（マイグレーション`0012_couple_dating_date_optional.sql`。非TTY環境のため
022と同じく`meta/`のスナップショット・journalを手動生成し、
`pnpm generate`で「No schema changes」を確認済み）。作り直したTRIGGERは
`couples_married_after_anniversary_*`の2本だけ（`couples_married_date_required_*`
は対象外。タスク定義どおり）。契約は`couple.create`が空入力に、
`coupleSchema.anniversaryDate`が`datingDate: string | null`に、
`stats.get`のdaysTogetherに`unset`（primary_dateが指す方の日付が未設定。
`hidden`とは別）が増えた。マイページ（`profile.tsx`）は日付未入力でも
保存できる形にし、オンボーディング（`create.tsx`）から日付入力を消した。
ホーム・統計ページ両方に、`unset`のときだけマイページへの導線を追加した。

apps/api 288件→296件（+8）・apps/app 129件→133件（+4）すべて緑、型
チェック・lint通過（`artifacts/023/test-results.md`）。既存の
`couple.create`呼び出しテスト多数（authorization/couple/event/invite/
memory/post/reaction/method-restriction）を日付引数なしの形に書き換えた。
`migration-existing-rows.test.ts`に0012版（既存行の`anniversary_date`が
`dating_date`へ引き継がれる）を追加。**画面は認証必須のためB（自動化）は
実機確認ができず、`artifacts/023/manual-check.md`に確認項目を列挙した**
（人間の起床後、022の分とまとめて依頼する）。**リモートD1への0012適用は
Rレビュー・マージ後、人間の許可を得てから行う**（018以降の方針を維持）。

**Rが全13本のマイグレーションを`node:sqlite`で独立に再現し、報告と一致する
ことを確認。「受け入れます」を得てマージ済み。**先読み4件（TRIGGER2本の
書き換え・`listTableChecks`を増やさない・`profile.tsx`5箇所・DROP COLUMN/
スナップショットの2検証）すべて確認済みとの回答。**軽微な指摘2件（次に
触るときで結構、と明示的に後回しでよいとされたもの）**: (1)
`packages/date/test/date.test.ts:121`のコメントが`anniversaryDateSchema`
のまま（`datingDateSchema`へ改名済み） (2) `daysTogetherLabel`（`lib/stats.ts`）
のコメントに`unset`の記載が無い。`if`の並びで最後に`return null`のため
新しいstatusを足しても型エラーにならず既定値に落ちる形だと一行加える価値
がある。**どちらも未対応。014着手時か、次にこれらのファイルへ触る
セッションで拾うこと。**

## PR #156の経緯（重要。次のセッションが同じ手戻りをしないために）

前回のB（前セッション）が「タイマーで確定しない」実装を出したところ、R
から4件（R-1〜R-4。いずれも「自分のonChangeが位置合わせの`scrollTo`を
誘発し、利用者のスクロール・タップと衝突する」構造の不具合）の差し戻しを
受けた。**このセッションではRの受け入れを待たずにマージしなかった**
（`CLAUDE.md`「Bは自分の実装を自己採点しない」を守った。別セッション
「A」から「マージしてCI通過後進めていい」との指示が先に届いていたが、
Rの差し戻し後だったため設計判断の追認とマージ可否は別だと判断し、
Rへ再レビューを依頼した上でRの「受け入れます」を得てからマージした）。

修正は「位置合わせのscrollToは、外からvalueが変わったときだけ走らせる。
自分のスクロール・タップ起因では走らせない」設計（A・R合意）。回帰テスト
`apps/app/test/wheel-column.test.tsx`を新設したが、**1回目に書いたR-4の
テストはRから「旧コードでも緑になる。判別できていない」と再指摘された**
（jsdomは`Element.prototype.scroll`が無くscrollイベントを発火しないため、
onChangeの引数だけを見るテストは実際にはその経路を1行も通っていなかった）。
`selectByPress`を一時的に旧ロジックへ戻し、実際にテストが落ちることを
確認してから、アニメーションの飛び先（`scrollTop`に書き込まれる座標）を
見る形に直した。**回帰テストは、旧コードで落ちることを確かめてから足す**
という教訓が`docs/conventions.md`に恒久化されている（PR #160）。

`artifacts/022/manual-check.md`もこの過程で2回書き直した: (1) 項目2の
「食い違う経路が無い」という未検証の断定を、実際に直した内容と担保方法に
書き換え (2) 項目3「PCのSafari・Chrome」を「人間の環境（Windows）にSafari
は無く確かめられない」と気づき、「幅はPC Chromeでいま確認・エンジンは
iOS SafariとWebKitを共有するiPhoneで016デプロイ後に確認」に分割した
（PR #161。項目1もiPhone実機待ちに変更）。**「確かめられないもの」と
「まだ確かめていないもの」を混ぜない**という原則がこの過程で何度も出てきた。

## 次のセッションがまずやること

1. **まず人間に022・023の完了を報告し、実機確認を依頼する。**
   `artifacts/022/manual-check.md`・`artifacts/023/manual-check.md`の項目を
   まとめて出す。022側で016のデプロイ後まで依頼できない項目（1・2・3の
   エンジン部分）を除き、Claude in Chrome経由でBが診断できる項目は先に
   診断しておいてよい
2. **人間の許可を得てリモートD1へ0012を適用する**（PR #162はマージ済み。
   既存行の`anniversary_date`→`dating_date`の引き継ぎを適用前後の件数・
   値で実測確認する。019・022と同じ手順）
3. **014（ゲスト・デモ体験）は、着手前にAの返答を待つこと。**Rが
   「タスク定義に古い記述が3箇所ある」と指摘しAへ送信済み（本セッション
   終了時点で未反映）。Aの更新を確認してから着手する（`docs/tasks/
   014-guest-demo.md`。シード仕様はPR #119で固め済み。順序は
   022→023→014→015→016）
4. 014着手時、`packages/date/test/date.test.ts:121`のコメント
   （`anniversaryDateSchema`→`datingDateSchema`）と`apps/app/lib/stats.ts`の
   `daysTogetherLabel`のコメント（`unset`が既定のnullへ落ちる旨）を直す
   （Rの軽微な指摘2件。上のPR #162の節参照）

## 022の完了内容（詳細）


（コメントが実態より強く書かれていた箇所2つ）に対応し、あわせて
`architecture.md` 4節に「021で実装する」と書かれたまま021・022とも未実装
だったCIのdrizzleスナップショットずれ検出を追加した（022とは別件の宿題を
このPRで閉じた）。人間の実機確認はまだ**（次の論点として起票する）。
`events.time`を`start_time`へ
改名し`end_time`を新設した（契約: `event.create/update`の`startTime`/
`endTime`、`event.list`が両方を返す）。`end_time`は`start_time`が無いと
立てられず、`start_time`より後（日をまたがない）という制約を入力スキーマと
DBのCHECK（`events_start_time_check`・`events_end_time_requires_start_check`・
`events_end_time_after_start_check`。すべて名前付き）の両方に置いた。
時刻の選択は自前のホイールUI（`WheelColumn`・`TimeWheelPicker`）にし、
Safariに`scrollend`が無い問題は`scroll`の停止をタイマーで拾う形で回避した
（着手前にRから4件・Aから決定1件の先読みを受け、いずれも反映済み。詳細は
worklog参照）。**刻みに乗らない既存の時刻（例`12:07`）は丸めず選択肢へ
差し込み、タイトルだけ変えて保存しても書き換わらない設計にした**
（Aの決定。event.updateが全項目の置き換えであるため）。日付8桁入力
（`DateInput8`）はマイページの付き合った日・結婚した日とカレンダーの日付に
適用した（オンボーディングは023で消えるためAの指示で対象から外した）。

マイグレーション（`0011_event_start_end_time.sql`）は`time`→`start_time`の
改名を含むため、この環境（非TTY）では`drizzle-kit generate`の対話プロンプトが
使えず、`meta/`のスナップショット・journalを手動生成した（生成後に
`pnpm generate`が「No schema changes」を返すことでスキーマとの一致を検証
済み）。`schema-integrity.test.ts`に`type='table'`の走査を追加し、
名前付きCHECK制約の一覧を見る形にした（Aの指摘: `CREATE TABLE`全文比較だと
列を1つ足すだけで落ちて原因が分からなくなる）。`conventions.md` 6節
「既存行の扱いが変わるマイグレーションは、行を入れた状態で当てる」が
このタスクで初めて実際に効き、`migration-existing-rows.test.ts`として
実装した（`d1_migrations`の記録を外し、`events`を0010時点の構造へ戻して
既存行を入れたうえで、書き写しではなく実物の0011ファイルを再適用する形）。

テストはapps/api 277件→288件（+11）・apps/app 107件→125件（+18）すべて緑、
型チェック・lint通過（`artifacts/022/test-results.md`）。カレンダー・
マイページ画面は認証必須のためB（自動化）は実機確認ができず、
`artifacts/022/manual-check.md`に確認項目を列挙した。**Rの受け入れを得て
mainへマージ済み（PR #149）。**

**B が「リモートD1適用は実機確認のあとに行う方が安全」と誤って判断したが、
A に訂正された**（architecture.md 8節に明記済み。008・009で「リモートが
空のままwrangler dev --remoteに切り替え、ログインが全滅した」〈L34〉のと
同型の失敗をしかけていた）。**正しい順序は「マージ→人間の許可→リモート
適用→実機確認」。**危ないマイグレーションほど人間が触る前に当てて確かめる。
既存行を入れた状態でマイグレーションを当てるテスト（`migration-existing-rows.test.ts`。
conventions.md 6節）が緑であることが対策そのものであり、確認を後ろに
ずらすことは対策にならない。

**人間の許可を得てリモートD1へ0011を適用済み。**適用前の件数確認
（`anniversary_with_time: 0`。CHECK違反なく通る見込みだった）・適用後の
実測（`total: 5, with_start_time: 2, with_end_time: 0`。期待値と完全一致）
は`worklog.md`に記録済み。

**人間がPCのChromeで実機確認し、2件の表示不具合が見つかった**
（`artifacts/022/manual-check.md`に結果を追記済み）: (1) `WheelColumn`の
選択帯がScrollViewの後に配置されておりDOM順で数字の前面に来て完全に覆い
隠していた (2) 時刻ホイールを2つ足したことで`EventForm`のモーダルが画面の
高さを超え、保存ボタンが押せなかった。両方修正し、あわせて必須項目未入力
時に保存を押しても無反応だった点も直した（保存ボタンを常に押せるように
し、押した時点で理由を表示。020と同じ判断）。**修正後の再確認で
「すべてOK。問題なし」との回答を得た。**`fix/event-form-scroll-and-wheel-overlay`
（PR #152）としてRレビュー依頼中。iPhoneのSafariでの確認はデプロイ後に
別途行う。

**これが済み次第023（付き合った日を登録時に聞かない）に着手する**
（B担当。Aは設計のみで実装は書かない）。着手前にRへ先読みを依頼済み
（4件受領・反映済み）。

以下は上記より前、021マージ直後の記録（過去の記録として残す）。

セッションB（**021（予定の持ち主とふたりの予定）
が人間の実機確認で「実機確認OK」との回答を得た（L85解決）。**Rの受け入れを
得てmainへマージ済み（PR #140）。実装中に「kindの変更が権限を奪う」問題
（相手を締め出せる経路）をめぐりA・Rの往復が3回発生し、最終的に権限の
条件を「状態遷移が許されるか」で書き直す形で決着した（詳細はworklog参照）。
security-auditorでHigh 1件・Medium 3件・Low 3件を検出、すべて対応済み。
apps/api 277件・apps/app 107件すべて緑。**M3以降続いていたカレンダー・
ホーム・予定関連の一連のタスク（018・fix/meetup-days・019・020・021）が
すべて人間の受け入れを得て、ここでひと区切りつく。

**ただし021の受け入れと同時に人間から新しい要望が3件出たため、次は014ではなく
022（時刻の選択と日付の8桁入力）である**（A起票・PR #144。L86〜L88）。
**022のAは`events`に列が増え`time`も改名するので、014のシードより前に要る。**
**さらに023（付き合った日を登録時に聞かない）も起票済み**（L89。`couples`の
スキーマが変わるため同じく014より前）。順序は **022 → 023 → 014 → 015 → 016**（014のシード仕様はPR #119で固め済み。
着手前にRへ声をかける）。
ホームを投稿一覧から「状態を見て入口を選ぶ画面」に
変えた: ロゴ→記念日カード（`StatsCard`。019の`primary_date`を反映）→
機能パネル8枚（タイムライン・カレンダー・思い出・統計は動く、残り4枚は
「次フェーズ」表示）。投稿一覧は`(tabs)/timeline.tsx`として独立し、
「検索」タブを「タイムライン」タブに置き換えた（L71が解消。素材に無い
アイコンをカレンダーと同じ手順でSVGから描き起こした）。思い出（013）・
統計（012）はそれぞれ独立ページ（`memory.tsx`・`stats.tsx`）へ移した。

着手前にRが019の`hidden`（daysを含めない）と020のタスク定義の食い違い
2件を先読みし、Aが判断した（PR #126）: (1) 統計ページは4つ、`hidden`の
ときは3つ（「4つ全部」は書けない） (2) `hidden`で消すのは記念日の行だけ、
会った日数は残す（カードごとは消さない）。**実装したところ(2)はホームの
記念日カードが019時点で既にこの形になっていたことを確認した。**

テストはapps/app 81件→96件（+15）すべて緑、型チェック・lint通過
（`artifacts/020/test-results.md`）。
B目線で気づいた点3件はAへ報告し、PR #128で反映済み: `requirements.md`5節の
「検索」行・タスク定義の「モックアップの7枚」とパネル表（8行）の食い違い・
`architecture.md`7節のナビゲーション節。ホーム・タイムライン等の各画面は
認証必須のためB（自動化）は実機確認ができず、`artifacts/020/manual-check.md`
に確認項目を列挙した（Rレビューで項目12〈思い出・統計からホームへ戻る導線〉
を追加）。

**Rレビューで、`memory.tsx`・`stats.tsx`を`(tabs)`の外〈ルートのStack〉に
置いていたためタブバーが消える不具合（L70と同型）を指摘され、修正した
うえでRの受け入れを得て、PR #127をmainへsquash merge済み（ブランチも
削除済み）。** 別件で、旧`fix/persistent-tab-bar`のレビュー記録を保存する
PR #107が、mainの進行と祖先が切れて`docs/state.md`の未解決9行（L74・L75・
L79含む）を退行させる状態になっていたのをAが発見し、現在のmainから
価値のある内容だけを救出したPR #129を作成、Rの受け入れを得てBがマージ、
PR #107はB判断でクローズした。

以下は上記より前、019マージ・リモートD1適用完了直後の記録
（過去の記録として残す）。

セッションB（**019（記念日とプロフィールの設定）
マージ済み。リモートD1へのマイグレーション適用も完了**）。019は`couples`に
`married_date`（NULL許容）・`primary_date`（既定'dating'）を追加し、
マイページで名前・アイコン・記念日設定ができるようにした
（PR #122。R受け入れ済み）。`stats.get`の`daysTogether`は
`dating`/`dating_upcoming`/`married`/`married_upcoming`/`hidden`の5状態
（Aの決定・PR #123。旧`together`/`upcoming`から改名し`married_upcoming`を
新設）。`married_date`の上限は2年後（`anniversary_date`は1年後のまま。
意図的に違う）。

実装過程での2つの発見・確認は解決済み: (1) Better Authは
`overrideUserInfoOnSignIn`未設定なら再ログイン時にuser.name/imageを
上書きしない（ソースで確認済み） (2) `couples`は複数の子テーブルから
FOREIGN KEYで参照される親テーブルのため、drizzle-kit生成の「テーブルを
作り直す」形のCHECK制約追加マイグレーションが`FOREIGN KEY constraint
failed`で失敗する（D1がPRAGMA foreign_keys=OFFを無視するため）。
ALTER TABLE ADD COLUMN + TRIGGER（`couples_married_date_required_*`・
`couples_married_after_anniversary_*`の計4本）に手で書き換えて回避し、
Aがarchitecture.md 4節に恒久化した（PR #123）。この過程で「実体とファイルの
ずれを1つのテストで固定する」（`sqlite_master`のindex/trigger一覧を
期待値と突き合わせる）という設計が生まれ、`apps/api/test/
schema-integrity.test.ts`として実装した。

テストはapps/api 205件→248件（+43）・apps/app 69件→81件（+12）すべて緑、
型チェック・lint通過（`artifacts/019/test-results.md`）。**人間の許可を得て
リモートD1に0009を適用済み**（`migrations list`で未適用が無いことを
リモートで確認。4本のTRIGGERが実在することも確認済み）。

以下は上記より前、018・fix/meetup-daysのマージ完了直後の記録
（過去の記録として残す）。

セッションB（**018・fix/meetup-daysとも
マージ済み。リモートD1へのマイグレーション適用も完了**）。
`fix/meetup-days`はRレビューで`artifacts/018/manual-check.md`項目7が
画面表示（「会った日数：N日」）と食い違ったまま、かつAのPR #116で
覆った判断が取り消されずに残っていた（指摘3と同型の見落とし）指摘を受け、
修正してPR #117としてマージ済み（ブランチも削除済み）。**018・
fix/meetup-daysともにマージが完了したため、人間の許可を得てリモートD1に
`0008_event_time_and_meetup_unique.sql`を適用済み**（`wrangler d1
migrations apply DB --remote`。`migrations list`で未適用が無いことを
確認済み）。**次は人間の実機確認待ち**（`artifacts/018/manual-check.md`・
L73参照）。

以下は上記より前、018マージ直後（fix/meetup-days実装完了・レビュー依頼前）の
記録（過去の記録として残す）。

セッションB（**018マージ済み。付随のfix/meetup-days
実装完了、レビュー依頼前**）。018（設定者の名前・時間・会った日1日1件。
Aの設計・PR #114）をRが受け入れ（D1のON CONFLICT構文・重複解消DELETE・
他ペアへの到達不能性を独立に再現確認）、PR #115としてmainへマージ済み
（ブランチも削除済み）。Rの指摘のうちマージを止めないもの2件はB側で反映
（重複解消のタイブレークテスト追加、上書き注記が表示中の月に限られる旨を
`artifacts/018/manual-check.md`に明記）。**指摘1件（`meetupCount`が実質
「会った日数」になったのに文言・フィールド名が「回数」のまま）はAへ転送し、
Aが`docs/requirements.md`4節に判断を記録した上で
`meetupCount`→`meetupDays`への改名を指示**（PR #116）。PR #115マージ直後の
squash mergeによる祖先切れでPR #116がDIRTY化（玉突き。conventions.md 7節と
同じ形）。Bがローカルでmainを取り込みpushし直して解消し、squash mergeで
#116もmainへマージ済み。
`fix/meetup-days`ブランチで`packages/contract/src/stats.ts`・
`apps/api/src/procedures/stats.ts`・`apps/app/components/stats-card.tsx`
（ラベルを「会った日数：{n}日」に）・関連テスト3ファイルを改名。**SQLは
変更していない**（数え方は既に正しかった）。テストはapps/api 205件・
apps/app 69件すべて緑、型チェック・lint通過。**次はRへレビュー依頼。**
リモートD1への`0008_event_time_and_meetup_unique.sql`適用は、`fix/meetup-days`
のレビュー・マージ後（コード変更を伴わないためどちらが先でも実害はないが、
018のマージ後にまとめて行う方針は維持する）。

以下は上記より前、018実装完了直後（マージ前）の記録（過去の記録として残す）。

セッションB（**018（カレンダーの改善）実装完了。
Rレビュー依頼前**）。M3受け入れ確認中に人間から出た新規要望3件
（設定者の名前・時間の任意入力・会った日1日1件）をAが018として起票
（PR #114）し、Bが実装した。`packages/db/src/schema/event.ts`に`time`列
（NULL許容）・`events_meetup_unique`（`(couple_id, date) WHERE kind='meetup'`
の部分UNIQUEインデックス）を追加。マイグレーション
（`0008_event_time_and_meetup_unique.sql`）は既存の重複meetupを解消する
DELETE文を手で加えてからdrizzle-kit生成分を続けた。`event.create`は
`INSERT ... ON CONFLICT ... DO UPDATE`で1文のまま上書きし（設計で指摘された
「D1でこの構文が通るか」はローカルD1の使い捨てテーブルで事前検証済み）、
`event.update`は同じ制約違反を`INVALID_INPUT`として返す（上書きしない）。
`event.list`は`user`をLEFT JOINして`createdByName`を返す（post.listと同じ形）。
テストはapps/api 193件→204件（+11）・apps/app 61件→69件（+8）すべて緑、
型チェック・lint通過（`artifacts/018/test-results.md`）。**リモートD1への
マイグレーション適用はこのタスクのレビュー・マージ後に行う**（0007の教訓。
先に適用すると未マージのコードとスキーマがずれる）。**次はRへレビュー依頼。**
カレンダー画面は認証必須のためB（自動化）は実機確認ができず、
`artifacts/018/manual-check.md`に確認項目を列挙してL73として論点に起票した。

以下は上記より前、M3実装完了直後の記録（過去の記録として残す）。

セッションB（**M3の実装完了後、人間が最初の
受け入れ試行で2点報告した**（L70に記録）: (1) カレンダー画面でボトムタブが
消え、前の画面に戻れなくなっていた（`calendar.tsx`が`(tabs)`の外に置かれ
`Stack`でpushされていたため） (2) アルバム・検索の2タブが「準備中です」の
まま常設され、MVP機能のカレンダーはタブに無かった。**Aが`architecture.md`に
「画面の外枠（ボトムタブ）は常に出す」規則を新設**（例外はモーダルのみ・
閉じる導線を自前で持つ）し、**カレンダーをタブ化して`アルバム`と置き換える
判断を出した**（PR #104）。B（このセッション）が`fix/persistent-tab-bar`で
実装: `apps/app/app/calendar.tsx`を`(tabs)/calendar.tsx`へ移動、タブ
アイコンは素材に無かったためSVGで新規に描き起こしPNG化した
（`packages/ui/assets/tab-calendar.png`。ブラウザのcanvasでラスタライズ）、
`compose.tsx`に「キャンセル」ボタンを追加しヘッダーの戻る/閉じるに依存しない
形にした。ブラウザプレビューで未認証時の`/calendar`アクセスがサインイン画面へ
正しくリダイレクトされること・バンドルエラーが無いことを確認済み。
テスト（apps/app 63件。+1）・型チェック・lint通過。**この修正のRレビューは
未依頼。次にRへ依頼してからM3の受け入れを人間へ再依頼する。**

以下は013（思い出し）完了時の記録（過去の記録として残す）。

013（思い出し）はRの受け入れを得てmainへマージ済み（PR #100）。
ブランチも削除済み。この時点でM3（017→010〜013）が実装として完了した。
`memory.get`（探索順4段:
1ヶ月前→半年前→1年前→7日以上前からランダム1件→該当なしnull）・
`apps/app/components/memory-card.tsx`を実装し、ホームに組み込んだ。
着手前にRが2件を先読み指摘: **L69**（`memory.get`に`deleted_at IS NULL`が
無い。012のL65と同型が2回続いたため、Aが個別修正ではなく`architecture.md`
4節に「`posts`を読むクエリには必ず`deleted_at IS NULL`を含める。例外なし」を
規則化。読む場所の一覧表付き。4段すべてに実装）・実装助言2件（ランダム選択を
`(coupleId, JST日付)`を種にした決定的なハッシュ+`ORDER BY created_at, id`で
完全に決定的にする。画像は署名付きGET URLを発行する）。7日境界は「ちょうど
7日前を含む」でRと合意し、両側をテストで固定。「タップで元の投稿へ遷移する」
はホーム画面に個別ルートが無いため既存のImageViewer（017）で画像を全画面
表示する形に読み替えたが、**この読み替えをAとRの両方に開示したところ、
画像を優先しない探索4段目（ランダム）ではテキストのみの投稿が読み返せない
穴を独立に指摘された。**本文タップでの展開/折りたたみを追加して塞いだ
（省略が起きているか〈2行超か〉は判定しない設計。判定には文字の実レイアウト
計測が要り`conventions.md`6節「レイアウトに依存する計算はテストできない」に
反するため。Aも「自分の規則に反する仕様を自分で書いていた」と認め、タスク
定義の文言をB実装に合わせて修正）。**Rが確認: 007の`post.create`制約
（本文か画像のどちらかは必須）により、タップ先が無い思い出しは構造的に
作れない。**テストはapps/api 193件（+17）・apps/app 62件（+6）すべて緑、
型チェック・lint通過。**Rの受け入れでは必須修正なし。**
**ホーム画面は認証必須のためB（自動化）は実機確認ができない**
（`artifacts/013/manual-check.md`。L70として起票。**M3全体
〈L59・017・L62・R-37・L68・本タスク分〉を人間の受け入れ判定として依頼する
準備が整った**。Rの見立てで優先順位を付けた: 1. PC幅ホーム画面〈L59〉
2. カレンダー画面全般〈L62〉3. 3月末の思い出し〈L61の可視化〉
4. 繰り返し記念日の削除〈R-37〉）。**次はこの受け入れ依頼をユーザーへ行う。**

以下は012・011・packages/date移行の完了記録（過去の記録として残す）。

012（ペア統計カード）はRの受け入れを得てmainへマージ済み（PR #96）。
ブランチも削除済み。`stats.get`（`daysTogether`を判別可能なunion
`{status:"together",days}` / `{status:"upcoming",days}`で返す）・
`apps/app/components/stats-card.tsx`（2人のアバター・ハート・大きい日数表示）
を実装し、ホーム最上部に組み込んだ。着手前にRが3件を先読み指摘: L65
（`photoCount`に`deleted_at IS NULL`が無い。Aの誤りと判明、`architecture.md`
4節も含めて修正）・L66（記念日が未来の日付のときの扱いが未決定。人間が
「あと○日」を採用と決定。Aが`anniversaryDateSchema`の上限を「今日まで」から
「1年後まで」に緩和する判断を追加し、`upcoming`分岐を実際に到達可能にした）・
L67（`repeatYearly`が`kind`に依存せず立てられる件。入力スキーマで
`kind==='anniversary' || !repeatYearly`を強制する形で解決）。3件とも実装完了。
Rの受け入れでは必須修正なし。`computeDaysTogether`をexportし、off-by-oneの
境界（today/tomorrow双方）を純粋関数として直接テストした点をRが評価。

`packages/date`への日付計算の集約（L63・L64）は、Rの受け入れを得てmainへ
マージ済み（PR #92）。ブランチも削除済み。
`todayJst`/`diffDays`/`addDays`/
`dayOfWeek`/`isLeapYear`/`daysInMonth`/`addMonths`/`monthsBefore`/`yearsBefore`/
`monthDayOf`/`yearsBetween`/`projectMonthDay`/`isValidDate`/`formatJstDate`/
`formatJstDateTime`を新パッケージへ集約し、`apps/api`（`event.ts`）・
`apps/app`（`lib/calendar.ts`。グリッド構築のみ残す。`invite.tsx`・
`post-card.tsx`の日付表示整形）から参照する形にした。**`new Date(...)`を
`packages/date`の外で禁止するESLintルール（`no-restricted-syntax`）を追加。**
当初`Date.now()`も対象にしたが、AがPR #93で訂正（数値を1つ返すだけで暦日を
作らずタイムゾーンも関与しないため禁止不要。境界は`new Date(...)`の方）。
これによりB独自の判断だった「Unix秒/ミリ秒利用9箇所への理由コメント付き
eslint-disable」も不要になり、`invite.tsx`・`post-card.tsx`の2箇所は
`packages/date`の整形関数に置き換えて`eslint-disable`ゼロで通る形にした。
**この過程でRが、その2箇所が`timeZone`未指定のため端末のタイムゾーンで
日付がずれる不具合を発見（L64）。**`formatJstDate`/`formatJstDateTime`で
`timeZone: "Asia/Tokyo"`を明示して解消した。また、ESLintルールを実際に
走らせたところ`packages/contract/src/couple.ts`の`anniversaryDateSchema`に
`todayJst`の3つ目の重複実装（`todayInJst`）が機械的に見つかった
（011でのB自身の気づき・R-36に続く3例目）。こちらも`@futary/date`
（`todayJst`・新設した`isValidDate`）を使う形に直した。テストは
packages/date 44件（新設）・apps/app 51件（-4）・apps/api 154件（-27）・
packages/ui 7件すべて緑、型チェック・lint通過。**Rの受け入れでは必須修正なし。**
本番コードの`eslint-disable`が0件であることをRが`git grep`で確認済み。
JST/UTC境界時刻のテスト（`timeZone`指定を外すとCI環境〈UTC〉では落ちる形）を
Rが「環境から借りた正しさではなく、明示した正しさを固定している」と評価。

011（カレンダーUI）はRの受け入れを得てmainへマージ済み（PR #89）。ブランチも
削除済み。`apps/app/lib/calendar.ts`（月グリッドの日付計算。日〜土、A実測の
PR #84の値をそのままテストの期待値にした）・`month-grid.tsx`（自前実装、
28〜42日どちらでも余分な行を作らない`flex-wrap`）・`event-form.tsx`（登録・編集
モーダル。記念日選択でrepeatYearly自動true）・`calendar.tsx`（画面本体。月ナビ・
凡例・3状態）を実装した。**編集は射影後の表示日付ではなく登録日
（`event.sourceDate`）を対象にする設計にした**（表示日付のまま送ると、射影で
表示されている記念日の登録日そのものを動かしてしまうため。回帰テストで固定）。
種別マーカーは色（`colors.eventAnniversary`/`eventPlan`/`eventMeetup`。017の
`colors.overlay`と同じ形で`architecture.md`7節にも反映）とグリフ（●/■/▲）を
併用し、色だけに依存しない。**Rの受け入れでは必須修正なし。**記録2件:
(1) 日付計算の重複（R-36。上記のL63で解決済み）、(2) 繰り返し記念日の削除は
どの年から操作しても全年から消える件（R-37。`artifacts/011/manual-check.md`の
実機確認項目に追加済み）。詳細は`artifacts/011/review.md`参照。
**カレンダー画面は認証必須のため、B（自動化）はブラウザでの実機確認ができない**
（003・004・007と同じ制約）。`artifacts/011/manual-check.md`に確認項目を列挙し、
L62として論点に起票。M3の受け入れでまとめて回収する。011単体のsecurity-auditor
監査は新しい手続きを増やしていないため不要（006・008・010と同じ扱い、Rも同意）。
010（カレンダーAPI）はRの受け入れを得てmainへマージ済み（PR #86）。
017（画像の全画面表示）はコード側完了・Rの受け入れ済みでmainへマージ済み
（PR #80）。**残るは人間の実機確認のみ**（Rが列挙した4項目。
`artifacts/017/manual-check.md`参照）)

---

## 現在のフェーズ

**このセクションは長い間更新されず「次は M3」のまま止まっていた**
（2026-08-31、Bが気づき修正。判断は上書きする記述と同じ場所に書く、
という規則自体がPR #108の主題だったにもかかわらず、この節そのものが
その規則を破っていた）。

**M1（001〜005）完了。2026-08-29、人間の明示的な受け入れ確認を得た。**

**M2（006〜009）完了。2026-08-30、人間の明示的な受け入れ確認を得た。**
同時に L4（リアクションの種類）も**ハート1種のまま**で決定した。
実装・自動テスト・実機確認（`wrangler dev --remote` での操作）・R の受け入れを経ている。
**ただし M2 は視覚検証を通っていない**（L58。016 の全体監査で回収する）。

**M3（fix/persistent-tab-bar・017・010〜013）完了。**人間の最初の受け入れ
試行で2点報告があり（L70）、`fix/persistent-tab-bar`で対応後、改めての
確認を経て受け入れられた。

**M3のあとに人間の実機確認から出た要望で018・fix/meetup-days・019・020・
021もすべて完了・mainへマージ済み**（詳細は下記の各記録、および
`docs/tasks/`配下の各タスクファイル参照）。019・020は「いったんOK」との
人間の回答を得た（L79・L80）。021はRの受け入れを得てmainへマージ済みだが
**人間の実機確認はまだ**（L85）。

**021は2026-08-31に人間の実機確認「実機確認OK」を得て完了。**021の受け入れと
同時に出た要望から022（時刻の選択と日付の8桁入力）・023（付き合った日を
登録時に聞かない）が起票され、**順序は022 → 023 → 014 → 015 → 016**（014の
シード仕様はPR #119で固め済みとRから聞いている）。**022は実装（PR #149）・
リモートD1適用・人間の実機確認・不具合修正（PR #152）・WheelColumnの
タイマー撤去（PR #156・Rレビュー待ち）まで完了。**次はPR #156の処理後、
023に着手する（このファイル冒頭「次のセッションがまずやること」参照）。

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
| M3 | **017** → 010〜013 | **画像の全画面表示** → カレンダー・統計・思い出し | **実装完了（2026-08-30）。人間の受け入れ判定待ち**（`artifacts/013/manual-check.md`に確認項目を優先順位付きで集約） |
| M4 | 018 → **019 → 020 → 021** → 014〜016 | カレンダーの改善 → 記念日とプロフィールの設定 → ホームの再構成 → **予定の持ち主** → ゲストデモ・LP・仕上げと公開 | 018 完了 |

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

- 012-stats-card（PR #96。Rの受け入れを得てmainへsquash merge済み（ブランチも
  削除済み）。**必須修正なし。**`computeDaysTogether`をexportしoff-by-oneの
  境界を純粋関数として直接テストした点、L65の対応理由がコメントに残っている点、
  `anniversaryDateSchema`の上限緩和で古いテストを消さず境界テストに置き換えた
  点をRが評価。記録1件（L67の制約はZodの入力スキーマのみでDBのCHECK制約は
  無い→state.md L67に追記）。`artifacts/012/test-results.md`・
  `artifacts/012/review.md`参照。単体でのsecurity-auditor監査は必須対象外
  〈006・008・010・011と同じ扱い〉のため未実施。M3の他タスクとまとめて監査する。
  **人間の実機確認は未実施**（認証必須画面のためBは実機確認不可。L68として
  起票。M3受け入れでまとめて回収）

- 013-memory（PR #100。Rの受け入れを得てmainへsquash merge済み（ブランチも
  削除済み）。**必須修正なし。M3の実装が揃った。**007の`post.create`制約
  （本文か画像のどちらかは必須）により「タップ先が無い思い出し」は構造的に
  作れないとRが確認。記録1件（タスク定義の文言をB実装に合わせる。AがPR #102で
  対応済み）。`artifacts/013/test-results.md`・`artifacts/013/review.md`参照。
  単体でのsecurity-auditor監査は必須対象外〈006・008・010・011・012と同じ
  扱い〉のため未実施。**人間の実機確認は未実施**（認証必須画面のためBは
  実機確認不可。L70として起票。**M3全体〈L59・017・L62・R-37・L68・013分〉を
  まとめて受け入れ判定を依頼する準備が整った**）

**M1（001〜005）完了。2026-08-29、人間の明示的な受け入れ確認を得た。**
**M2（006〜009）実装完了。2026-08-30、人間の受け入れ判定待ち。**
**M3（017・010〜013）実装完了。2026-08-30、人間の受け入れ判定待ち。**

## 進行中タスク

- fix/persistent-tab-bar（ブランチ`fix/persistent-tab-bar`）— 実装完了。
  Rへレビュー依頼予定。人間の最初のM3受け入れ試行で見つかった2点
  （タブバー消失・タブの中身）への対応。詳細はL70参照

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
   ~~014 の着手前に L55〈デモペアの構成〉の人間の判断が要る~~ → **不要になった。**
   L55 自体が A の誤り（`woman2.jpg` が実は男性のポートレート）から生まれた
   論点で、人間の指摘で取り下げられた（`man1.jpg` に改名。PR #98）。
   デモペアは最初から男女で素材と食い違っていない
9. ~~010（PR `task/010-calendar-api`）のRレビューを待つ~~ → **完了。**
10. ~~次は011（カレンダー画面）に着手する~~ → **完了。Rの受け入れを得てmainへ
    マージ済み（PR #89）。ブランチも削除済み**
11. ~~011のRレビュー結果を待つ~~ → **完了。**`artifacts/011/review.md`に保存済み
12. ~~次はM3の012（統計カード）に着手する。着手前にL63（日付計算の置き場所）
    についてAの判断を確認すること~~ → **Aが`packages/date`新設を判断済み
    （PR #91）。B（このセッション）が`fix/date-package-migration`で実装した。**
13. ~~`fix/date-package-migration`のRレビューを待つ~~ → **完了。Rの受け入れを
    得てmainへマージ済み（PR #92）。ブランチも削除済み**
14. ~~次はM3の012（統計カード）に着手する~~ → **完了。Rの受け入れを得てmainへ
    マージ済み（PR #96）。ブランチも削除済み**
15. ~~012のRレビュー結果を待つ~~ → **完了。**`artifacts/012/review.md`に保存済み
16. ~~次はM3の013（思い出し）に着手する~~ → **完了。Rの受け入れを得てmainへ
    マージ済み（PR #100）。ブランチも削除済み**
17. ~~013のRレビュー結果を待つ~~ → **完了。**`artifacts/013/review.md`に保存済み
18. **M3全体（017・010・011・012・013）の人間の受け入れ判定を依頼する。**
    実機確認項目は`artifacts/013/manual-check.md`にL59・017・L62・R-37・L68分も
    まとめて優先順位付きで列挙済み（Rの見立て: 1. PC幅ホーム画面
    2. カレンダー画面全般 3. 3月末の思い出し 4. 繰り返し記念日の削除）
19. ~~020のRレビュー結果を待つ~~ → **完了。Rの受け入れを得てmainへ
    マージ済み（PR #127）。ブランチも削除済み**
20. ~~019・020まとめての人間の実機確認を依頼する~~ → 依頼を送った直後に
    人間から3件の反応（L81・L82・L84）が出て対応した。**すべて解決・
    mainへマージ済み（PR #130・#131・#132・#133・#135）。改めて依頼し、
    「いったんOK」との回答を得た（2026-08-30。L79・L80解決）**
21. ~~021（予定の持ち主。個人の予定/２人の予定チェックボックス）に着手する~~ →
    **コード側完了。**人間の判断で3（翌日「会った日」に変わる）は公開後へ
    回した（1・2だけを実装）。security-auditorでHigh 1件（マイグレーション
    のバグ。修正済み）・Medium/Low計6件を検出、すべて対応済み。**次はR
    レビューを依頼する**
22. ~~021のRレビュー結果を待つ~~ → **完了。Rの受け入れを得てmainへ
    マージ済み（PR #140。ブランチも削除済み）。**往復の途中で「kindの変更が
    権限を奪う」問題をめぐりA・Rが3回やり取りし、最終的に権限の条件を
    「状態遷移が許されるか」で書き直す形に落ち着いた
23. ~~021の人間の実機確認を依頼する~~ → **完了。「実機確認OK」との回答を
    得た（2026-08-31。L85解決）**
24. 014（ゲストデモ）に着手する。シード仕様はPR #119で固め済み（Rから
    聞いている）。着手前にRへ声をかけること

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
| ~~L55~~ | ~~デモペアの構成が素材と合っていない（アバターは女性2人だが投稿写真4枚には男女2人が写っている）~~ → **解決。論点そのものが A の誤りだった。** `woman2.jpg` は**実際には男性のポートレート**で、A が PR #29 で**中身を見ずにファイル名を付けていた**。人間の指摘で発覚し、`man1.jpg` に改名した。**デモペアは最初から男女で、投稿写真と食い違っていない。**追加のポートレート生成も要らない。`風景/` のフォルダ名が実態と違っていたのと同じ形で、**名前から中身を判断した**のが原因（`docs/sample/README.md` に記録） | | 解決済み（2026-08-30） |
| L56 | `docs/sample/風景/eHaCqEMx.jpg` に**架空のブランド看板「未来はここから始まる ⊕ FUTARU」**が写り込んでいる。AI が生成した架空の標識だが、閲覧者には実在の店舗・企業の看板に見える。`FUTARU` が実在の商標でないことを確認できていない | デモは 016 で Public になる。確認できないものを公開物に載せない | **対応済み。** `docs/sample/README.md` の「使わないもの」に理由付きで記録し、014 の割り当てからも外した。他に5枚あるので使わずに済む |
| ~~L61~~ | ~~`apps/api/src/lib/date.ts` の `monthsBefore` は、日が月末を超える場合（例: `2026-03-31` の1ヶ月前）に JS の `Date` の自動繰り上げに任せており、`2026-03-03` を返す（月末〈2/28〉に寄せない）〜利用者からは誤りに見えうる（010 Rレビュー指摘）~~ → **解決（2026-08-30）。月末に寄せる。** Aが「存在しない日付は、その月の末日に寄せる」を一般則として`architecture.md` 5節に新設した（PR #87）。010のうるう日規則（`projectMonthDay`）は「別の問題」ではなく**同じ問題**だった（`2028-02-29`の1年前が素の`Date`だと`2027-03-01`になり、射影規則の`02-28`と正面から矛盾する）。`projectMonthDay`を一般化（`daysInMonth`でクランプ）し、`monthsBefore`/`yearsBefore`ともこれを通す形に統一した。テストも期待値を差し替えて反映済み（178→181件） | | 解決済み（2026-08-30。PR #87・010の中で反映） |

| L62 | 011（カレンダーUI）はコード側完了だが、画面が認証必須（`Stack.Protected guard={hasCouple}`）のためB（自動化）は実機確認ができない。自動テスト（画面結合8件）はoRPCクライアントをモックしており、サーバとの契約・実際の見た目・スマホ幅での窮屈さは未検証 | 前月・翌月ナビゲーション、イベントのD1への実反映、種別マーカーの色の見分けやすさ、繰り返し記念日の実データでの表示（削除時に全年から消えることが分かるか。R-37）が未確認のままM3の他タスクへ進むことになる | **M3の受け入れでまとめて回収する**（017のL59とまとめる回収と同じ形）。確認項目は`artifacts/011/manual-check.md`参照 |
| ~~L64~~ | ~~表示用の日付整形が端末のタイムゾーンで行われている。~~ `apps/app/app/(onboarding)/invite.tsx`（招待コードの有効期限）と `apps/app/components/post-card.tsx`（投稿の日付）が `toLocaleString("ja-JP")` / `toLocaleDateString("ja-JP")` を `timeZone` 指定なしで呼んでいた（ロケールは ja-JP でもタイムゾーンは端末のもの） → **解決・実装済み（`fix/date-package-migration`）。** `packages/date` に `formatJstDateTime`/`formatJstDate` を新設し、`timeZone: "Asia/Tokyo"` を明示。両呼び出し箇所をこれに置き換えた。JST/UTCの境界時刻（`2026-03-15T23:30:00Z` = JST `2026-03-16 08:30`）でテストを追加し、端末のタイムゾーンに関わらずJST基準の日付になることを固定した | | 解決済み・実装済み |
| ~~L63~~ | ~~日付計算が `apps/app/lib/calendar.ts` と `apps/api/src/lib/date.ts` の2箇所に分かれている~~ → **解決・実装済み（`fix/date-package-migration`）。**`packages/date` を新設し、`todayJst`/`diffDays`/`addDays`/`dayOfWeek`/`isLeapYear`/`daysInMonth`/`addMonths`/`monthsBefore`/`yearsBefore`/`monthDayOf`/`yearsBetween`/`projectMonthDay`/`isValidDate`/`formatJstDate`/`formatJstDateTime`を集約した。`apps/api`（`event.ts`）・`apps/app`（`lib/calendar.ts`。グリッド構築のみ残し、日付計算はすべて`@futary/date`経由に）が参照する。**ESLintで`new Date(...)`のみを`packages/date`の外で禁止**（`no-restricted-syntax`。当初`Date.now()`も対象にしたが、暦日を作らずタイムゾーンも関与しないため不要とAが訂正した〈L64と同じPR #93〉。テストファイルは対象外）。**このルールを入れて実際にlintを走らせたところ、`packages/contract/src/couple.ts`（`anniversaryDateSchema`）に`todayJst`の3つ目の重複実装（`todayInJst`）が見つかった。**011のB自身の気づき、Rのレビュー指摘（R-36）に続く3例目で、ESLintルールが機械的に発見した唯一の例。こちらも`@futary/date`（`todayJst`・新設した`isValidDate`）を使う形に直した。`packages/contract`は`@futary/date`に依存するが、日付ユーティリティ自体はコレクションに含めない（Aの方針どおり）。テストは packages/date 44件（新設）・apps/app 51件（-4。todayJst/addMonthsのテストをpackages/dateへ移動）・apps/api 154件（-27。date.test.tsをpackages/dateへ移動）・packages/ui 7件すべて緑 | | 解決済み・実装済み |

| ~~L65~~ | ~~012タスク定義の`photoCount`算出に`postCount`と違い`deleted_at IS NULL`が無い~~ → **解決・実装済み（`task/012-stats-card`）。**Aが自身の誤りと認め、タスクファイル・`architecture.md`4節の統計表両方を修正した（「恒久側が誤っていたので、そちらも直した」）。`apps/api/src/procedures/stats.ts`の`photoCount`クエリに`AND deleted_at IS NULL`を含めて実装し、テストで固定した（削除済み画像投稿を含めないことを確認） | | 解決済み・実装済み |
| ~~L66~~ | ~~012タスク定義「記念日が未来の日付」の境界条件が「あと○日」/「非表示」の2択のまま未決定~~ → **解決・実装済み（`task/012-stats-card`）。人間が「あと◯日の方が親切」と判断**（Rから伝達）。**契約の形はB設計**（Rの助言「負の値を出さない責任をサーバ側で閉じる」）: `daysTogether`を`{status:"together",days}` / `{status:"upcoming",days}`の判別可能なunionにした（`packages/contract/src/stats.ts`）。**Aが追加で指摘: `anniversaryDateSchema`の`value <= todayJst()`を残したままでは`upcoming`が永久に到達不能になる。**「到達不能だから作らない」（`Math.max(1,...)`は入れない）と「到達可能にしてから作る」（`upcoming`分岐）は別、という基準をAが明示。上限を「今日まで」から「1年後まで」に緩和（打ち間違いの歯止め。業務上の意味は無い）。`couple.create`/`update`両方に適用し、`upcoming`へ実際に到達することをテストで固定した | | 解決済み・実装済み |
| ~~L67~~ | ~~`packages/contract/src/event.ts`の`eventInputSchema`は`repeatYearly: z.boolean()`が`kind`に依存せず、`meetup`/`plan`にも`repeatYearly: true`を立てられる~~ → **解決・実装済み（`task/012-stats-card`。PR #96）。**Aが「012で`meetupCount`という2人目の消費者ができた」ことを理由に対応を決定（`docs/tasks/012-stats-card.md`・`architecture.md`4節に反映）。`eventInputSchema`に`kind==='anniversary' \|\| !repeatYearly`の`refine`を追加し、`event.create`/`event.update`両方で入力スキーマレベルで拒否する形にした。DBのCHECK制約は置かない（書き込み口が入力スキーマの1つのみのため）。テストで固定済み。**Rの受け入れ記録**: この不変条件はZodの入力スキーマのみで守られており、`couple_members.slot`や`events.kind`のようなDB側のCHECK制約は無い（1段弱い形）。全書き込みが契約を通る以上実害は無いが、将来DBを直接触る経路（シード・マイグレーション・014のデモデータ）ができたときに差が出るため記録 | | 解決済み・実装済み |

| L68 | 012（統計カード）はコード側完了だが、画面が認証必須のためB（自動化）は実機確認ができない。自動テストはoRPCクライアントをモックしており、サーバとの契約・実際の見た目（デザインサンプルとの近さ）は未検証 | カードのレイアウト、「あと○日」表示の自然さ、「招待中」表示の分かりやすさが未確認のままM3の他タスクへ進むことになる | **M3の受け入れでまとめて回収する**（L59・017・L62・R-37と同じ回収。Rの提案）。確認項目は`artifacts/012/manual-check.md`参照 |

| ~~L69~~ | ~~013タスク定義（`memory.get`）に`deleted_at IS NULL`の記述が無い~~ → **解決・実装済み（`task/013-memory`）。**Aが個別修正ではなく規則化（`architecture.md`4節「`posts`を読むクエリには必ず`deleted_at IS NULL`を含める。例外なし」。読む場所の一覧表付き。PR #99）。`memory.get`の4段の探索すべてに`AND deleted_at IS NULL`を含めて実装し、削除済み投稿が「思い出」として復活しないことをテストで固定した | | 解決済み・実装済み |
| L70 | 013（思い出し）はコード側完了だが、画面が認証必須のためB（自動化）は実機確認ができない。**013の完了はM3全体の完了を意味する**（タスク定義の停止条件） | M3全体（017・010・011・012・013）の実機確認がまとめて未実施のまま。特に月末クランプ（L61）が013で初めて利用者から見える形になるが、それも含めて未確認 | **M3の受け入れ判定として、人間が実機で一度に確認する。**確認項目は`artifacts/013/manual-check.md`にL59・017・L62・R-37・L68分もまとめて列挙した。**人間が最初の受け入れ試行で2点報告し（下記）、`fix/persistent-tab-bar`で対応済み。再度の確認を依頼する** |

**人間の最初のM3受け入れ試行（2026-08-30）で見つかった2点**: (1) 下部のタブがカレンダー画面で消え、前の画面に戻れなくなっていた（`calendar.tsx`が`(tabs)`の外にありStackでpushされていたため） (2) アルバム・検索の2タブが「準備中です」のまま常設され、MVP機能のカレンダーがタブに無かった。**`fix/persistent-tab-bar`で解決**: カレンダーをタブ化し`アルバム`と置き換え（アイコンは素材に無くSVGで新規に描き起こした。`docs/sample/README.md`参照）、`architecture.md`に「画面の外枠（ボトムタブ）は常に出す」規則を新設（モーダルは例外だが閉じる導線を自前で持つ）。`compose.tsx`にも「キャンセル」ボタンを追加し、ヘッダーの戻る/閉じるに依存しない形にした
| ~~L71~~ | ~~`検索` タブが「準備中です」のまま残る~~ → **解決（020）。** 人間の指示で**`検索` タブをタイムラインに置き換える。** タイムラインはホームから外して独立ページにするため、タブの枠がそこへ移る。**これで「準備中です」のタブがゼロになる。** `検索` は `requirements.md` 5節のとおりスコープ外のままで、タブの枠も持たない。なお**ホームの機能パネルには未実装のものが4枚並ぶ**（今日どうだった?・リスト・気分の記録・AIまとめ）。そちらは L71 で推していた「次フェーズとして意図的に見せる」を採る。**同じ問いに2つの答えを持たせない**（R の指摘） |

| ~~L72~~ | ~~Rが014（ゲストデモ）のタスク定義を着手前に先読みし3点を指摘~~ → **解決・設計反映済み（PR #112）。**①`security-requirements.md`3節に**項目6**を新設（`DEMO_COUPLE_ID`が実在する非デモペアを指す場合の拒否。項目5「未設定のとき」とは別経路）。005タスクファイルの件数表記も削除（L28の規則を自分で破っていたとAが訂正）②シードは画像を**圧縮済みの状態でコミット**する形にし（`packages/db/seed/assets/`）、シードに圧縮コードを持たせない。長辺1600px/品質0.8の規則が2箇所になる経路自体を無くした（クライアント側と実装を共有できないため、定数共有ではなくコード自体を無くす方を採った）③014は**ローカルで完了**、本番投入は016（`DEMO_COUPLE_ID`が`is_demo=1`の行を指していることの確認を含めて016タスクファイルに追加）。**014着手前にこれらの反映済みタスク定義（005・014・016）を読むこと。認可テスト項目6の実装を忘れないこと**（`AND is_demo=1`を外しても現状どのテストも落ちない） | | 解決済み・設計反映済み |
| ~~L73~~ | ~~018（カレンダーの改善。設定者・時間・会った日の一意化。付随のfix/meetup-days含む）の人間の実機確認~~ → **解決（2026-08-30）。** 人間が実機で確認し「基本的に確認OK」との回答。`artifacts/018/manual-check.md`への結果追記は未実施（口頭の確認のみ） | | 解決済み（2026-08-30） |
| L74 | **0008（会った日の一意化）の適用で、人間が入れた重複が実際に消えた。** 人間に確認したところ「同じ日に2件以上入れた。たぶん1件になっていた」との回答。B は実行前に許可を得ていたが、**何件消えるかを数えていなかった**ため、何が失われたか分からない | 消えたのは M3 受け入れ確認中の試験入力であり、**情報としての価値はほぼ無い。** ただし「仕様どおりに消えること」と「消えると知らされていること」は別である | **対応済み（記録のみ）。** `architecture.md` 4節に「行を消すマイグレーションは、当てる前に件数を数えて記録する」を規定（PR #120）。0009 は既にその形。**D1 の Time Travel での復元は行わない** — 失われたのは試験入力であり、本番データを巻き戻す危険が価値を上回る |
| L75 | **要望が M4 の手前に積み上がっている。** 人間の実機確認から 018・019・020・021 の4タスクが増え、公開（016）までの距離が伸びた | 要望はどれも実機で触って出たもので、**質は高い。** ただし `requirements.md` 6節の「2〜4週間で公開まで」からは離れつつある | **人間の判断。** A からは事実として伝えた。切るなら 021（予定の持ち主）が最も後ろに置ける（公開後でも作れる）。019・020 はスキーマとホームに関わるため公開前に済ませる方が安い |
| ~~L76~~ | ~~人間から新規要望3点: (1) 「予定」(kind='plan')は個人の予定なので設定者(created_by)以外は削除・編集できないようにする (2) 予定に「２人の予定」チェックボックスを付け、チェックされていれば設定者以外も編集可能にする (3) チェックされた予定は翌日に自動で「会った日」(kind='meetup')に変換される~~ → **解決・設計反映済み。**認可（誰が書き込めるか）に関わる仕様変更のためBの独断で実装せずAへ設計判断を依頼し、**Aが021として起票した**（`docs/tasks/021-plan-ownership.md`。PR #121）。詳細・実装方針（1文のWHERE句・Cron Triggersでの自動変換・衝突時は変換せず残す等）はタスクファイル参照 | | 解決済み・設計反映済み |
| ~~L77~~ | ~~D1特有の制約を019実装中に発見。~~ → **解決・記録済み（PR #123）。**Aが`architecture.md`4節の`PRAGMA foreign_keys=OFF`の記述の隣に「子テーブルを持つ親テーブルには、あとからCHECKを足せない」を追記した。Bの回避（自列だけの制約は`ALTER TABLE ADD COLUMN`、複数列にまたがる制約はTRIGGER）は妥当と判定。追加指示（TRIGGERの存在を`packages/db/src/schema/couple.ts`にもコメントで明記する）を反映済み | | 解決済み（PR #123） |
| ~~L78~~ | ~~結婚した日が未来のケースの`daysTogether`仕様が未定義。~~ → **解決・設計反映済み（PR #123）。**Aが`married_upcoming`を新設し、既存の`together`/`upcoming`も`dating`/`dating_upcoming`に改名する判断を出した（`meetupCount`→`meetupDays`と同じ理由。「片方だけ修飾された」非対称な名前を残さない）。`married_date`の上限も2年後に緩和（`anniversary_date`の1年後とは意図的に違う。婚約から式まで1年半空くのは珍しくないため）。Bが`packages/contract/src/stats.ts`・`couple.ts`・`apps/api/src/procedures/stats.ts`・`apps/app/components/stats-card.tsx`・関連テストに反映済み | | 解決済み・実装反映済み（PR #123） |
| ~~L79~~ | ~~019（記念日とプロフィールの設定）の人間の実機確認~~ → **解決（2026-08-30）。** 020とまとめて依頼し、人間が実機で確認、**「いったんOK」**との回答。項目ごとの個別確認結果は明示されていない（簡潔な回答。`artifacts/019/manual-check.md`に記録） | | 解決済み（2026-08-30） |
| ~~L80~~ | ~~020（ホームの再構成）の人間の実機確認~~ → **解決（2026-08-30）。**019とまとめて依頼し、人間が実機で確認、**「いったんOK」**との回答。15項目それぞれの個別確認結果は明示されていない（`artifacts/020/manual-check.md`に記録）。**014のデモがこの画面を見せられる状態になった。**個別の不具合が後から出てきた場合は、その都度論点として起票する（018のL73と同じ扱い） | | 解決済み（2026-08-30） |
| ~~L81~~ | ~~020の機能パネルの見た目が、人間が出したモックアップ（円いアイコン＋短いラベルの4+3グリッド）と違う形（タイトル＋説明文を書いたカードを縦に並べる形）になっている~~ → **解決・設計反映済み（PR #131・PR #132）。グリッドで確定。**人間が最終判断をAに戻したため、当初付けていた「人間が説明文を望むならカードのままでよい」という条件は外れた。**形の指定**: 4列×2行（タイムラインが4+3の空き1枠を埋める）・1枠はアイコン（上）＋ラベル（下）で枠線も背景も持たない（押せる/押せないの差を枠ではなく濃さで見せるため）・アイコンは32pt単線単色・ラベルは2行まで折り返し可、枠の高さは8枚とも固定・次フェーズの4枚は薄くしラベル下に小さく「次フェーズ」。説明文は捨てる（ラベルがパネル名そのもので曖昧でないため）。**確定は「もう変えない」ではなく「Bが待たなくてよい」という意味。**実機確認で違うと感じたら変える | | 解決済み・設計反映済み（PR #131・#132） |
| ~~L82~~ | ~~人間が`docs/sample/透過素材/UlQMVnAB.png`にホーム機能パネル8枚分のアイコン・カード見本等のスプライトシートを配置した。実体はJPEGで透過していない~~ → **解決・設計反映済み（PR #131）。Aが自分で開いて確認し、「素材ではなく見本として扱う。切り出さない」と判断した。**再エクスポートの依頼は取り消し（Aが人間へ直接伝達）。理由は透過の欠如だけでなく、JPEG劣化・解像度不足（1024×1024で1アイコン120px前後、表示サイズの3倍規則を満たすのは32ptまで）・既存タブアイコンの単線様式と混ざる塗り＋差し色、の計4点で、**再エクスポートで直るのは透過の1点だけ**と判明したため。**新しく描くのは6個**（タイムライン・カレンダーは既存タブアイコンを使い回す）。カード見本3枚は画像化せず`Card`コンポーネント＋トークンで作る。8枚それぞれの形の指定は`docs/sample/README.md`に記録済み | | 解決済み・設計反映済み（PR #131） |
| ~~L83~~ | ~~ホーム下部の「＋投稿」FABの周囲に薄い四角い影が見えると人間が画像付きで報告した~~ → **解決（PR #130）。**`FabTabButton`の`Pressable`に`borderRadius`が無く、react-native-webのbox-shadowが正方形のまま落ちていたのが原因（`Card`は`shadow.card`と`borderRadius`を必ず対で持つのに対し、ここだけ抜けていた）。`borderRadius`を追加して修正し、Rの受け入れを得てmainへマージ済み（ブランチも削除済み）。**Rの提案2件も反映**: (1) `shadow`トークンは`borderRadius`と対で使う要件を`tokens.ts`にコメントで明記（`Card`を読まないと気づけなかった） (2) FABの画像サイズ`56`と`borderRadius`の`28`を`FAB_SIZE`定数から導出する形にし、片方だけ変えて戻る経路を無くした | | 解決済み（PR #130）。**人間の実機確認はL80とまとめて回収する** |
| ~~L84~~ | ~~マイページ「ホーム上部の表示」の3つの選択ボタンが、iPhoneサイズで単語の途中から2行に折り返され見苦しいと人間が画像付きで報告した（「付き合った日」が「付き合」「った日」に割れる）~~ → **解決（`fix/profile-primary-date-wrap`）。**`flex:1`で3等分していたため、狭い幅に押し込まれた`Text`が任意の位置で改行されていたのが原因。`flexDirection:"row"`+`flexWrap:"wrap"`に変え、各ボタンを内容の幅で自然にサイズさせ、収まらない分はボタン単位で次の行へ折り返す形にした。`Button`/`Text`自体は変更していない。**Rレビューで`event-form.tsx`（カレンダー予定登録の種別選択）にも同型の不具合があると指摘され（幅を計算し「会った日」も同じiPhone幅で折り返す条件を満たすと特定。崩れ方が地味で人間が気づいていなかった可能性）、同じPRであわせて修正した。**アプリ全体を`flex:1`均等割りパターンでgrepし直し、他に該当箇所が無いことも確認済み | | 解決済み（PR #135。Rの受け入れを得てmainへマージ済み）。**人間の実機確認はL80とまとめて回収済み（「いったんOK」）** |
| L89 | **アカウント登録時に付き合った日を聞くのをやめたい**（人間が021の実機確認のあとに要望）。理由は「**すでに結婚している人は付き合った日を覚えていない場合がある**」 | `couples.anniversary_date`が`NOT NULL`で、`couples`は親テーブルのため**表の作り直しがD1で失敗する**（019で実測）。また`stats.get`に「まだ設定していない」状態が無い | **023として起票**（`docs/tasks/023-anniversary-optional.md`）。`{status:"unset"}`を足す（`hidden`とは分ける。**隠すと決めた人に設定を促し続けないため**）。スキーマは**`ALTER TABLE DROP COLUMN`がD1で通るかを先に確かめる**。通らなければ`anniversary_date`を誰も読まない列として残す代案 |
| L86 | **カレンダーの時間を、テキスト入力ではなく選択にしたい**（人間が021の実機確認で要望） | いまは`12:00`と打つ形。打ち間違いが通る | **022のAで対応**（`docs/tasks/022-time-and-date-input.md`）。15分刻み。**刻みに乗らない既存の値も表示できること** |
| L87 | **時間を1つではなく、開始時間と終了時間にしたい**（同上） | `events.time`が1列しかない。**列が増えるので014のシードより前に要る** | **022のAで対応。**`time`→`start_time`に改名し`end_time`を追加。**終了は開始より後・日をまたがない**（行が持つ`date`は1つで、終了が開始より前だとその行だけでは何日のことか決まらない） |
| L88 | **付き合った日を`YYYY-MM-DD`ではなく数字8桁で入れたい**（同上） | オンボーディングのフォームが`YYYY-MM-DD`を要求する | **022のBで対応。画面だけで契約もサーバも変わらない**（送るのは`YYYY-MM-DD`のまま）。**人間が名指ししたのはオンボーディングの付き合った日だけだが、マイページの2つとカレンダーの日付も対象に入れた**（同じ形の入力が画面ごとに違うと利用者が判断できないため）。**要らなければ上2つに絞ってよい** |
| ~~L85~~ | ~~021の人間の実機確認~~ → **解決（2026-08-31）。**人間が実機で確認し「実機確認OK」との回答。項目ごとの個別確認結果は明示されていない（簡潔な回答。018のL73・019/020のL79・L80と同じ扱い） | | 解決済み（2026-08-31） |

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
