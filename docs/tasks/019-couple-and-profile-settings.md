# 019: 記念日とプロフィールの設定

## 目的
マイページで、ふたりの記念日と自分のプロフィールを設定できるようにする。

人間が M3 の受け入れ確認中に出した要望のうち、**データの形が変わる部分**をここで確定させる。

- 名前とアイコン画像を変えたい（いまは Google のプロフィール固定）
- **付き合った日**と**結婚した日**を設定したい
- ホーム上部に「付き合って〇日目」か「結婚して〇日目」か**選べる**ようにしたい。
  **非表示**にもできるようにしたい

## なぜ 014 の前に置くか

**`couples` と `user` のスキーマが変わる。**

014 のシードは**この2つの表にも行を入れる。**後から列が増えれば
**シードを書き直すことになる**（018 を 014 の前に置いたのと同じ構造。R の指摘）。

015 の LP と 016 の本番スクリーンショットも、ホーム上部の表示に依存する。
ただし**そちらは後から直せる。シードの書き直しは前提の話である。**

## 変更対象ファイル
- `packages/db/src/schema/couple.ts` — `married_date`・表示設定
- `packages/db/src/schema/auth.ts` — プロフィールの上書き（下記の検証しだい）
- （新規）`packages/db/migrations/xxxx_couple_dates_and_profile.sql`
- `packages/contract/src/couple.ts` / `me.ts`
- `apps/api/src/procedures/couple.ts` / `me.ts`
- `apps/app/app/(tabs)/profile.tsx` — 設定 UI

---

## 1. 記念日を2つ持てるようにする

| 列 | |
|---|---|
| `anniversary_date` | **既存。**付き合った日。NOT NULL のまま |
| `married_date` | **追加。**NULL 許容 |
| `primary_date` | **追加。**`'dating'` / `'married'` / `'none'`。既定は `'dating'` |

- **`primary_date` に CHECK を置く。**`events.kind` と同じ理由で、
  未知の値が1件でも入ると出力検証全体を巻き込む（`architecture.md` 4節）
- **`primary_date = 'married'` なのに `married_date` が NULL、という状態を作らない。**
  入力スキーマで拒否し、**CHECK でも表す**
  （シードが入力スキーマを通らない2つ目の書き込み口になる。014 と同じ理由）

```sql
CHECK (primary_date IN ('dating','married','none'))
CHECK (primary_date <> 'married' OR married_date IS NOT NULL)
```

- `married_date` にも `anniversary_date` と同じ検証を当てる
  （`1900-01-01` 以降、存在する日付）。**ただし未来の上限だけ違う**（下記）
- **`married_date` が `anniversary_date` より前になることを許さない。**
  結婚が交際開始より前にはならない。
  **これも TRIGGER で表す。**入力スキーマだけにしない。
  `primary_date = 'married'` なのに `married_date` が NULL を CHECK にも置いた理由
  （**シードが入力スキーマを通らない2つ目の書き込み口になる**）は、
  **順序の規則にもそのまま当てはまる**（R の指摘）。
  014 のシードは `couples` に行を入れる。**片方だけ DB で守る理由が無い**

## 2. `stats.get` の返し方

`daysTogether` は**判別可能な union のまま**（012・L66）。`primary_date` を反映する。

```
{ status: "dating",           days }   付き合って N 日目
{ status: "dating_upcoming",  days }   その日まであと N 日
{ status: "married",          days }   結婚して N 日目
{ status: "married_upcoming", days }   結婚まであと N 日
{ status: "hidden" }                   非表示
```

### 名前を `together` / `upcoming` から変える

012 では `together` / `upcoming` の2つだった。**結婚の側が増えると破綻する。**

`upcoming` は**どちらの日に向かっているのかを名前が言っていない。**
`married_upcoming` を足すなら、`upcoming` も `dating_upcoming` でなければ、
**同じ意味の名前が片方だけ修飾されている**状態になる。

`meetupCount` → `meetupDays` と同じ理由である。
**名前が中身を言っていない状態を残さない。**019 はまだマージされていないので、
**いま直す方が安い。**

### 結婚予定日は未来を許す

**`married_upcoming` は例外的な状態ではない。**結婚式の日が決まっている
ふたりにとって、「**結婚まであと N 日**」は主役になりうる数字である。

- `anniversary_date` の上限は**1年後まで**のまま（打ち間違いを弾くため）
- **`married_date` の上限は2年後まで。**婚約から式まで1年半ほど空くことは珍しくない。
  `2126-05-18` のような打ち間違いは2年でも十分弾ける
- **上限が違う理由をここに書いた。**違うこと自体は意図であって、揃え忘れではない

**`hidden` に `days` を入れない。**入れると、非表示にしたはずの数字が
レスポンスに乗って**開発者ツールから見える。**
「恥ずかしいから隠したい」という要望に対して、**隠れていない。**

## 3. 名前とアイコンの変更

### まず確かめること

**Better Auth が Google ログインのたびに `user.name` / `user.image` を
上書きするかどうかを、先に確認する。**

上書きするなら、`user` の列を直接書き換えても**次のログインで消える。**
その場合は**別の列を足して、そちらを優先して読む**形にする。

**確認してから設計を決める。**動くはずだ、で進めない。

### どちらに転んでも守ること

- `post.list` の `authorName` / `authorImage`、`event.list` の `createdByName` は
  **同じ出所を読む。**表示名の決め方を2箇所に持たない
- アイコン画像は **007 の仕組みを再利用する。**署名付き PUT、クライアント側で圧縮、
  鍵はサーバが組み立てる（`architecture.md` 5節・6節）。
  **`couples/{coupleId}/...` とは別の前綴りにする**（ペアに属さない個人の持ち物である）
- 名前に長さの上限を置く（例: 20文字）。空文字を許さない

## 4. マイページの UI

- 名前とアイコンの変更
- 付き合った日・結婚した日の設定
- **ホーム上部の表示の選択**（付き合って〇日目 / 結婚して〇日目 / 非表示）
- ログアウト（既存）

**記念日はふたりの共有データである。**片方が変えればもう片方にも反映される。
**変更した本人以外にも影響することが分かる形にする。**

---

## テストで証明すること
- `primary_date = 'married'` かつ `married_date` が NULL を**作れない**（入力・CHECK の両方）
- `married_date < anniversary_date` を**作れない**
- `primary_date = 'none'` のとき、`stats.get` の応答に**日数が含まれない**
- `me.update` で他人のプロフィールを変更できない
- `security-requirements.md` 3節の認可テストが緑（件数と内容は出典側を見る）

## 確認観点
- 非表示にしたとき、**レスポンスにも数字が乗っていないか**（開発者ツールで確認）
- 結婚した日を設定して表示を切り替えたとき、ホーム上部が正しく変わるか
- 名前を変えたあと、**タイムラインとカレンダーの両方**で新しい名前が出るか

## 完了条件
- [ ] 名前とアイコンを変更でき、**再ログインしても消えない**
- [ ] 付き合った日・結婚した日を設定できる
- [ ] ホーム上部の表示を3通りから選べ、非表示が本当に隠れている
- [ ] **結婚予定日（未来）を設定すると「結婚まであと N 日」が出る**
- [ ] 上記のテストが緑
- [ ] **`sqlite_master` の索引と TRIGGER の一覧を期待値と突き合わせるテストがある**
      （`architecture.md` 4節。**014 で `events` を作り直す前に置く**）
- [ ] `artifacts/019/` に**人間の実機確認の記録**を保存

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション

## 進捗
- [x] Better Auth の上書き挙動を確認する（`overrideUserInfoOnSignIn`未設定なら
      上書きされない。ソース〈`oauth2/link-account.mjs`〉で確認済み）
- [x] スキーマ + マイグレーション（0009。D1のFK制約でdrizzle-kit生成の
      テーブル差し替え手順が使えず、ALTER TABLE ADD COLUMN + TRIGGERに
      手で書き換えた。詳細はartifacts/019/test-results.md）
- [x] 契約と手続き
- [x] マイページ UI
- [x] テスト
- [x] 証跡保存 → `state.md` 更新 → `worklog.md` 追記

実装は完了。**完了条件の最後（人間の実機確認）だけ未達。**
`artifacts/019/manual-check.md`参照。結婚した日が未来のケースの仕様が
未確定のままAへ確認依頼中（worklog.md参照）
