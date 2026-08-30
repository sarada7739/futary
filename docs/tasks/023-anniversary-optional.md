# 023: 付き合った日を、登録時に聞かない

## 目的
**アカウント登録（オンボーディング）で「付き合った日」を聞くのをやめる。**
**マイページであとから設定する**（019 で既に設定できる）。

人間が 021 の実機確認のあとに出した要望。

> **すでに結婚している人は、付き合った日を覚えていない場合がある**

**登録の最初の画面で、答えられない質問を必須にしない。**

## なぜ 014 の前に置くか

**`couples` のスキーマが変わる。**014 のシードはこの表に行を入れる。
順序は **022 → 023 → 014 → 015 → 016**。

**022 とは独立である。**どちらが先でもよいが、**同時に触らない**
（022 は `events`、023 は `couples`）。

---

## 1. 「まだ設定していない」は「非表示」と違う

`stats.get` の `daysTogether` に**状態が1つ足りない。**

| いま | |
|---|---|
| `dating` / `dating_upcoming` / `married` / `married_upcoming` | 日付がある |
| `hidden` | **本人が隠すと決めた** |

**登録時に聞かなくなると、「まだ決めていない」行ができる。**

**`{ status: "unset" }` を足す。`days` は入れない**（`hidden` と同じ）。

### `hidden` と分ける理由

**画面上はどちらも記念日の行が消えるが、意味が違う。**

- `unset` … **まだ決めていない。**マイページへの導線を出してよい
- `hidden` … **本人が隠すと決めた。**何も出さない

**同じにすると、隠すと決めた人に「設定してください」と出し続けることになる。**
**019 で「非表示にしたはずの数字を応答に乗せない」と決めたのと同じ筋である。**

### いつ `unset` になるか

**`primary_date` が指している方の日付が無いとき。**

| `primary_date` | `anniversary_date` | `married_date` | |
|---|---|---|---|
| `dating` | 無い | — | **`unset`** |
| `married` | — | 無い | **`unset`** |
| `none` | — | — | `hidden` |

**「片方の日付があるから、そっちを出す」はしない。**
**利用者が選んだ方を出す。**選んでいない方を勝手に出さない。

**会った日数・投稿数・写真の枚数は、いつでも出る。**
020 で決めたとおり、**消すのは記念日の行だけである。**

---

## 2. スキーマ: `anniversary_date` を NULL 許容にする

**ここが重い。**

```
couples.anniversary_date  TEXT  NOT NULL
```

**`couples` は親テーブルである**（`couple_members` / `invites` / `invite_failures` /
`events` / `posts` から参照される）。**表を作り直す形は D1 で失敗する**
（`architecture.md` 4節。019 で実測済み）。
SQLite に `ALTER COLUMN` は無いので、**`NOT NULL` を単純には外せない。**

### 先に確かめること

**`ALTER TABLE couples DROP COLUMN` が D1 で通るか。**
SQLite 3.35 以降にはあるが、**通るなら表を作り直さずに済む。**
**通らなければ下の代案に切り替える。「通るはずだ」で進めない**
（021 の Cron Triggers と同じ扱い）。

### 通る場合

1. `ALTER TABLE couples ADD COLUMN dating_date TEXT`（**NULL 許容**）
2. `UPDATE couples SET dating_date = anniversary_date`（**全行**）
3. 019 の TRIGGER 4本を落として、`dating_date` を見る形で作り直す
4. `ALTER TABLE couples DROP COLUMN anniversary_date`

**3 を飛ばすと 4 が落ちる。**TRIGGER が `anniversary_date` を参照している。

### 通らない場合

**`anniversary_date` を残したまま、誰も読まない列にする。**
1〜3 まで同じで、4 をやらない。

- **`anniversary_date` は `NOT NULL` のまま残る。**新規行には**作成日**を入れる
- **どこからも読まない。**`packages/db` のスキーマにコメントで理由を書く
  （`architecture.md` 4節の TRIGGER と同じ扱い。**ファイルを読んだ人に見える形にする**）
- **これは妥協である。**列が1つ、意味を失ったまま残る。
  **016 の前にやる作業ではない**ので、そのまま公開してよい

### どちらでも共通

- **既存行の値は捨てない。**人間のペアには実際の日付が入っている
- **`conventions.md` 6節「既存行の扱いが変わるマイグレーションは、行を入れた状態で
  当てる」の対象である。**`TEST_MIGRATIONS` をスライスして、
  **`dating_date` に元の値が移っていること**を確かめる
- **`schema-integrity.test.ts` で TRIGGER 4本が作り直されていることを見る**
  （落として作り直すため。`architecture.md` 4節）

---

## 3. 契約と画面

```
couple.create   {}            付き合った日を受け取らない
couple.update   { datingDate?, marriedDate?, primaryDate? }   019 のまま。列名だけ変わる
stats.get       daysTogether に { status: "unset" } が増える
```

- **オンボーディングから日付の入力を消す。**ペアを作る操作だけが残る
- **マイページは 019 のまま。**そこで設定する
- **ホームの記念日カードが `unset` のとき、マイページへの導線を出す**
  （`hidden` のときは出さない）

### 022 との重なり

**022 の B（日付8桁）が対象にしていた「オンボーディングの付き合った日」は、
この 023 で消える。**022 の対象は**マイページの2つとカレンダーの日付**になる。

**022 を先にやるなら、消える画面に8桁入力を入れることになる。**
**023 を先にやれば、その分は要らない。**どちらでもよいが、**知っていて選ぶ。**

---

## テストで証明すること
- **`anniversary_date` が無い行で `stats.get` が `unset` を返す**（`days` を含まない）
- **`primary_date='married'` で `married_date` が無いときも `unset`**
- **`primary_date='none'` は `hidden`**（`unset` にならない）
- **`unset` でも `meetupDays`・`postCount`・`photoCount` は返る**
- `couple.create` が日付なしで通る
- **マイグレーション後、既存行の `dating_date` に元の値が入っている**
  （既存行を入れた状態で当てる）
- **TRIGGER 4本が存在する**（`schema-integrity.test.ts`）

## 確認観点
- **登録が短くなったか**（ペアを作るだけで終わるか）
- **ホームで「まだ設定していない」と分かるか。**そこからマイページへ行けるか
- **非表示にしている人に、設定を促す表示が出ていないか**
- 既に設定している人の日数が、**マイグレーションの前後で変わっていないか**

## 完了条件
- [ ] オンボーディングで付き合った日を聞かない
- [ ] `stats.get` が `unset` を返し、画面がマイページへの導線を出す
- [ ] 上記のテストが緑
- [ ] `artifacts/023/` に**人間の実機確認の記録**を保存

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション
- **`DROP COLUMN` が通るかを先に確かめる。**通らなければ代案に切り替え、
  **そのことを `architecture.md` 4節に書く**（019 の TRIGGER と同じ形で、
  **次に同じ壁に当たる人のために残す**）

## 進捗
- [ ] `ALTER TABLE DROP COLUMN` が D1 で通るか確かめる
- [ ] スキーマ + マイグレーション（`dating_date`・TRIGGER の作り直し）
- [ ] 契約の変更（`couple.create`・`stats.get` の `unset`）
- [ ] オンボーディングから日付の入力を消す
- [ ] ホームの `unset` 表示とマイページへの導線
- [ ] テスト
- [ ] 証跡保存 → `state.md` 更新 → `worklog.md` 追記
