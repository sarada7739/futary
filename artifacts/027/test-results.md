# 027: 行きたい場所・食べたいものリスト — テスト結果

## データモデル・マイグレーション

`packages/db/src/schema/wish.ts`に`wishes`テーブルを新設（`0016_wishes.sql`）。
`kind`・`done_by`・`note`・CHECK制約のいずれも持たない（タスク定義1・6節。
「カフェ」は場所でもあり食べ物でもあるため分類させない）。新規テーブルで
他表からFK参照されないため、`architecture.md`4節「子テーブルを持つ親テーブル」
の問題（TRIGGERへの回避等）は起きなかった。`apps/api/test/schema-integrity.test.ts`
に`wishes_couple_created_idx`を追加。

## サーバ側（`apps/api/src/procedures/wish.ts`）

契約は`packages/contract/src/wish.ts`。`wish.list`は`readProcedure`、
`wish.create`/`setDone`/`delete`は`writeProcedure`を使う（既存の認可基盤に
そのまま乗る）。

- **並び順**: `ORDER BY (done_at IS NULL) DESC, created_at DESC`の1文で、
  未達成が先・達成済みが後・それぞれ新しい順を表現した
- **`setDone`の冥等性**: `SET done_at = CASE WHEN ?1 THEN COALESCE(done_at, ?2) ELSE NULL END`
  とすることで、既に達成済みの行へ`done:true`を再送してもdone_atの値が
  変わらない（`toggle`だと二重発火で行ったり来たりする問題を、単に
  `{id,done}`を受け取るだけでなく実装側でも厳密に冪等にした）
- **上限（LIMIT_REACHED）**: `SELECT COUNT(*)`してから`INSERT`する2文構成。
  同時実行での競合により上限を数件超えうる設計判断だが、ペアのメンバーで
  なければ到達できず、実害はストレージのみ（security-auditor監査で
  「脆弱性ではない」と判定済み）
- 権限はペアで共有（`created_by`はDBに持つがレスポンスに含めない。
  021のplan持ち主の仕組みは持ち込まない）

`apps/api/test/wish.test.ts`（新規・18テスト）で証明した項目:
- 基本のCRUD・他ペアのidはNOT_FOUND・作成者でない側も操作可能
- 並び順（未達成→達成済み、それぞれ新しい順）
- `setDone`の冥等性（同じdoneを2回送っても結果が変わらない）
- 論理削除（`deleted_at IS NULL`で絞られ一覧に出ない）
- 上限（200件目まで作れて201件目はLIMIT_REACHED。達成済み・論理削除済みの
  数え方の違いも個別に検証）
- titleのtrim・空文字拒否

`apps/api/test/authorization.test.ts`に、他の手続きと揃える形で
デモ経由のFORBIDDEN（3件）・NEEDS_ONBOARDING（4件）・デモペアの読み取り
スコープ（1件）を追加した。

## security-auditor監査とその是正（重要）

実装完了後にsecurity-auditorエージェントによる監査を実施し、**Highが1件
見つかった**: `me.delete`（024で実装したアカウント削除）が`wishes`を
削除する文を持たないため、`wishes.couple_id`が`couples(id)`をFK参照する
（D1はFKを常に強制する）ことと相まって、**wishを1件でも持つペアは
`DELETE FROM couples`がFK違反で失敗し、アカウント削除が恒久的にできなく
なる**という指摘だった。`db.batch()`は文のエラーで全文ロールバックするため、
R2の画像は既に削除済みなのに投稿本文・wish等は消えずに残る、という
中間状態にもなりうる。

対応（`apps/api/src/procedures/me.ts`）:
- `db.batch()`に`DELETE FROM wishes WHERE couple_id = ?1`を追加
  （events削除の直後・invites削除の前）
- 冒頭の削除順序コメントを1〜7に更新

再発防止（Medium指摘への対応。`apps/api/test/me.test.ts`）:
- 既存の全体削除テストにwish作成・削除確認を追加
- 「couple_membersを消した時点で〜」テスト、it.eachの途中停止再実行
  テストにもwishesの手順を追加
- **新規テスト**「couple_id列を持つ全ての表で、me.delete後にそのペアの
  行が0件になる」を追加。`sqlite_master`のCREATE TABLE文字列から
  `` `couple_id` ``列を持つ表を機械的に検出し、新しい表が増えたときの
  削除漏れを次からは自動的に検知できるようにした（手で一覧を維持する形の
  再発を避ける。`authorization.test.ts`の`collectProcedures`走査と同じ考え方）。
  D1は`PRAGMA table_info`を許可しない（`SQLITE_AUTH`。実測で確認）ため、
  `schema-integrity.test.ts`の`extractNamedChecks`と同じ、CREATE TABLE
  文字列を正規表現で走査する方式にした

再監査でHigh解消を確認済み（詳細はworklog.md参照）。Low指摘3件は
`docs/state.md`の該当節参照。

`docs/tasks/027-wish-list.md`90-91行目の「新規テーブルであり、他表から
FK参照されない」という記述は、**参照される側**としては正しいが
**`wishes`が`couples`・`user`を参照する側になったこと**（＝削除順序に
影響する）を見落としていた。B（自分）がこの記述を安全の根拠として
読んでいたため、実装だけでなくこの1行の訂正もAへ申し送りが必要
（`docs/state.md`参照）。

## クライアント側（`apps/app/app/(tabs)/list.tsx`）

- ホームの「リスト」パネル（020で設置済み）に`onPress`を追加し、
  `/list`へ遷移するようにした（`(tabs)/_layout.tsx`に`href: null`で登録。
  memory.tsx・stats.tsxと同じ扱い）
- モーダルにせず画面上部に1行の入力欄＋追加ボタン
- 3状態（読み込み中・空・エラー）を実装。空のときは「まだ何もありません」
  ではなく何を入れる場所かを説明する文言にした
- チェック（`wish.setDone`）・削除（`wish.delete`。post-card.tsxのDeleteMenuと
  同じ「押す→確認→削除する」の2段階）
- ゲスト（`isGuestMode`）のときは入力欄・追加ボタンの代わりにログイン導線を
  出し、チェック・削除も押せない形にした（014の導線。押してからサーバに
  拒まれる形にしない）
- `wish.list`の呼び出しは`viewerKey`をqueryKeyに含める（T9。
  `viewer-key-coverage.test.ts`が`readProcedure`経由の手続きとして自動検出）

`apps/app/test/list-screen.test.tsx`（新規・10テスト）・
`apps/app/test/home-screen.test.tsx`（「リスト」が次フェーズから動くパネルへ
移った分を更新）。

`pnpm -w test`: apps/app 193件・apps/api 355件・packages/db 20件、全て緑。
`pnpm -r type-check`・`eslint .`、両方通過。

## デモシード（`packages/db/seed/demo.ts`）

未達成4件・達成済み3件を決定的に（乱数なし）追加。実在の店名は使っていない
（014で写真1枚を落としたのと同じ理由）。ブラウザでの実機確認（下記）で、
デモの並び順（未達成が新しい順→達成済みが新しい順）が正しく表示される
ことを確認した。

## Bによるブラウザでの確認（未認証・デモ経路のみ）

マイページ等と異なり、`wish.list`は`readProcedure`のためゲスト（デモ）でも
一覧を閲覧できる。`wrangler dev`（ローカルD1・マイグレーション適用済み）+
`expo start --web`でローカルに実ビルドを配信し、Browser paneで確認した。

- ホームの「リスト」パネルが「次フェーズ」表示から通常のパネルに変わり、
  押すと`/list`へ遷移する（デスクトップ幅・モバイル幅375×812の両方で
  レイアウト崩れなし）
- デモの一覧が「水族館に行く→新しいカフェを開拓する→キャンプに行く→
  遊園地で遊ぶ（未達成・新しい順）→手作りケーキに挑戦する→花火大会を
  見る→映画館で新作を観る（達成済み・新しい順）」の順で表示される
  （デモシードの`createdAt`の設定どおり）
- ゲストでは「追加はログインすると使えます」の表示に置き換わり、
  入力欄・追加ボタンが存在しない。チェックボックス（□）をクリックしても
  何も起きない（押せる形になっていないことを実際にクリックして確認）
- `/api/wish/list`が200 OKで応答し、コンソールエラーは無い

**認証必須の経路（追加・チェック・チェック解除・削除、実際のアカウントでの
操作）はB（自動化）では実機確認ができない**（マイページ等と同じ制約。
`CLAUDE.md`「Bは自分の実装を自己採点しない」）。`artifacts/027/manual-check.md`
参照。
