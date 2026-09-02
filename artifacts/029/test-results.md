# 029: 気分の記録 — テスト結果

## データモデル・マイグレーション

`packages/db/src/schema/mood.ts`に`moods`テーブルを新設。複合主キー
`(couple_id, user_id, date)`で「1日1件/人」をDBで担保し、名前付きCHECK
`moods_level_range_check`でlevelの範囲（1〜5）をDB側にも置いた
（`architecture.md`4節「CHECKには必ず名前を付ける」）。論理削除列を持たない
（物理削除。`requirements.md`6節の例外。`deleted_at`を足すと複合主キーと
衝突し、消したあと同じ日を再登録できなくなるため）。

`0018_moods.sql`は新規テーブルの1マイグレーション（他表からFK参照されない）。
`schema-integrity.test.ts`に`moods_level_range_check`の存在を固定するケースを
追加した。

## 契約（`packages/contract/src/mood.ts`）

```
mood.setToday    { level }        -> { date, level }
mood.clearToday  ()               -> { date }
mood.list        { from, to }     -> { mine, partner }
```

- `setToday`/`clearToday`は`user_id`を引数に取らない（`ctx.userId`のみ使用。
  「渡せないものは、間違えて渡せない」）
- `mood.list`は`mine`/`partner`を分けて返す（1本の配列に`userId`を混ぜない）
- 範囲は最大400日。`event.list`と同じ数に揃えた
  （`conventions.md`5節「線に合っていないもの」にAが記載）
- `level`は`z.number().int().min(1).max(5)`。DBを読まないと分からない条件では
  ないためZodで弾く（`BAD_REQUEST`。`conventions.md`5節）

## サーバ側（`apps/api/src/procedures/mood.ts`）

- `setToday`: `todayJst()`をサーバ側で計算し、複合主キーへの
  `ON CONFLICT DO UPDATE`でupsert（同じ日に2回呼んでも行が増えない）
- `clearToday`: 物理削除。無い日に呼んでも冪等に同じ`{date}`を返す
- `list`: `couple_members`をslot順に取得し、未認証（デモ）時は1人目を
  `mine`・2人目を`partner`として扱う（B独自の設計判断。タスク定義に
  明記なし。どちらが「わたし」表示になっても実害はなく、ふたり分が
  見えることの方がデモ体験として重要と判断した）

`apps/api/test/mood.test.ts`（新規）で証明した項目:
- 自分の記録は`mine`に、相手の記録は`partner.items`に出る（取り違えない）
- 同じ日に2回`setToday`を呼んでも行が増えず上書きされる
- levelが0/6/-1/1.5だと`BAD_REQUEST`（Zod）
- `moods_level_range_check`はDB側にも効いている（procedureを迂回した直接
  INSERTで確認）
- 他ペアの記録は一覧に混ざらない
- 相手が未参加のペアでは`partner`がnull
- 400日の範囲は通り、401日は`INVALID_INPUT`。fromがtoより後も`INVALID_INPUT`
- `clearToday`は物理削除で、記録が無い日に呼んでもエラーにならない
- `clearToday`は相手の記録に影響しない

`apps/api/test/authorization.test.ts`に追加した項目:
- `mood.setToday`/`mood.clearToday`はDEMO_COUPLE_ID設定下でもFORBIDDEN
- `mood.list`はDEMO_COUPLE_IDのペアの記録だけを返す（他ペアと混ざらない）
- ペア未所属のユーザーが呼ぶと3手続きとも`NEEDS_ONBOARDING`
- 認可の基底を経由しない手続きが無いことを確認する機械的走査の下限値を
  26→29に更新（security-auditor指摘）

## `me.delete`への追加（`apps/api/src/procedures/me.ts`）

`moods`はcouples/userを参照する側であり、D1はFKを常に強制するため、
削除文を足さないと気分を1件でも記録したペアはアカウント削除が恒久的に
失敗する（027でwishesを踏んだのと同じ形）。`wishes`削除の直後、
`invites`削除の前に追加した。

`apps/api/test/me.test.ts`に追加した項目:
- 「ペアの全データが消え」テストにmoods確認を追加
- `couple_id`列を持つ全表を機械的に検出して0件確認するテストに
  `mood.setToday`呼び出しを追加（moodsが自動的に走査対象へ拾われる）

## クライアント側

- `apps/app/app/(tabs)/mood.tsx`（新規画面）: 上に5段階の選択ボタン
  （もう一度押すと取り消す）、下に「わたし」「相手」の月マス目を縦に
  2つ並べる。相手が未参加のペアでは相手の段を出さない
- `apps/app/components/mood-month-grid.tsx`（新規）: `month-grid.tsx`と
  同じ形の月マス目。グラフ描画ライブラリを使わず`View`の背景色だけで
  濃さを表現。新しい色トークンを追加せず、`colors.primary`から不透明度
  （0.2〜1.0の5段階）を計算して導出。未記録は枠線だけで、色の濃淡ではなく
  枠線の有無で区別する（薄い色と未記録を見間違えないため）
- 色だけで区別しない: 「今日: ふつう」のように言葉でも段階を出す。
  マスに`accessibilityLabel`（日付+段階）を付けた
- ホームの「気分の記録」パネルに`onPress`を追加（`router.push("/mood")`）
- ゲスト（デモ閲覧者）には記録ボタンの代わりにログイン導線を表示

`apps/app/test/mood-screen.test.tsx`（新規）で証明した項目:
- 今日まだ記録していないとき・記録があるときの表示
- 相手が未参加のとき相手の段が出ない／相手がいれば名前付きで出る
- 取得失敗時に再試行ボタンが出る
- 段階を選ぶと`mood.setToday`が呼ばれ、選択が反映される
- 選択中の段階をもう一度押すと`mood.clearToday`が呼ばれ、選択が外れる
- ゲストには選択ボタンの代わりにログイン導線が出る

`apps/app/test/home-screen.test.tsx`を更新（「気分の記録」が次フェーズから
動くパネルへ移り、動くパネル6枚・次フェーズパネル2枚になった）。

`apps/app/test/viewer-key-coverage.test.ts`は`mood.list`が
`use(readProcedure)`を経由するため自動的に走査対象へ拾われ、追加の手動登録
なしで通過した。

## デモシード（`packages/db/seed/demo.ts`）

2人分・3ヶ月（90日）分を決定的に組み立てた（乱数を使わず、固定パターン配列
と`addDays`のみで日付を作る）。固定パターンに`null`を混ぜて空の日を作り、
2人で別のパターン（ゆいは総じて高め、れんは起伏が大きい）を使うことで
傾向の違いを出した。`demo.test.ts`に以下を追加:
- moodsが2人分入っており、levelが1〜5の範囲である
- moodsが90日の範囲に収まる
- 空の日が両者とも混ざっている
- 2人のmoodsが同じ傾向（全て同じ値）にならない
- 外部キー順のDELETE文にmoodsが正しい位置（wishesの後、invitesの前）で
  含まれる

## 全体テスト・型チェック・lint

`pnpm test`: packages/date 46件・packages/ui 7件・packages/db 25件・
apps/app 213件・apps/api 399件、全て緑。
`pnpm type-check`・`pnpm lint`、両方通過。

## Bによるブラウザでの確認（未認証・デモ経路）

ローカルD1に0018を適用・デモ再投入後、`wrangler dev` + `expo start --web`
でBrowser paneから確認。

- ホームの「気分の記録」パネルが「次フェーズ」表示から外れ、押すと
  `/mood`へ遷移する
- デモの「わたし」「れん」2段の月マス目が表示され、levelに応じた濃淡と
  空の日（枠線のみ）が正しく描き分けられている
- 前月へ移動すると、より濃淡の差がはっきり見える1ヶ月分のデータが表示され、
  2人の傾向が視覚的に異なることを確認した
- ゲストでは「今日の気分」欄が選択ボタンではなくログイン導線になっている
- デスクトップ幅・モバイル幅375×812の両方でレイアウト崩れなし
- コンソールエラー無し

**認証必須の経路（実際にsetToday/clearTodayでボタンを押して記録・取り消す
操作）はB（自動化）では実機確認ができない**（027・028と同じ制約）。
`artifacts/029/manual-check.md`参照。

## security-auditorの監査

**High以上はゼロ。**Low 3件、詳細は`artifacts/029/security-audit-raw.md`参照:
1. 認可の基底を経由しない手続きが無いことを確認する機械的走査の下限値が
   古いまま（26のまま更新されていなかった）→ 29に修正済み
2. `me.delete`のmoods削除が`couple_id`だけで、`user_id`側のFKに依存した
   不変条件がある（現状は到達不能。将来「ペア解消」機能実装時の設計メモ
   として記録）
3. `dateSchema`が実在しない日付（2月99日等）を弾かない
   （`event.list`と共通の既存パターンで、mood固有の退行ではない）
