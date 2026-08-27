# 004: ペア作成と招待コード

## 目的
ユーザーがペアを作り、6桁の招待コードでパートナーを迎え入れられるようにする。
以降の全データが `couple_id` に紐づくため、この土台が必要。

## 変更対象ファイル
- （新規）`packages/db/schema/couple.ts` — `couples` / `couple_members` / `invites`
- （新規）`packages/db/migrations/xxxx_couple.sql`
- （新規）`apps/api/src/procedures/couple.ts`
- （新規）`apps/api/src/lib/invite-code.ts` — コード生成
- `packages/contract/` — `couple.create` / `couple.get` / `couple.update` / `invite.issue` / `invite.accept`
- （新規）`apps/app/app/(onboarding)/` — ペア作成画面、招待コード表示画面、コード入力画面

## 実装内容
- スキーマは `docs/architecture.md` 4節の定義に従う
- `couple.create`: `anniversaryDate`（付き合った日）を受け取り、couple を作成して作成者を参加させる
- `invite.issue`: 6桁のコードを発行する
  - `crypto.getRandomValues` を使う。**`Math.random()` を使わない**
  - 紛らわしい文字（`0` `O` `1` `I` `l`）を除いた文字集合を使う
  - 有効期限は発行から24時間
  - **1ペアにつき有効なコードは1件**。再発行したら前のコードを無効化する
- `invite.accept`: コードを受け取ってペアに参加する
  - **`db.transaction()` を使わない。** D1 にインタラクティブなトランザクションは無い
    （`docs/architecture.md` 4節「D1 にインタラクティブなトランザクションは無い」）。
    `drizzle-orm/d1` の `transaction()` は生の `BEGIN` / `COMMIT` を発行するため実行時に失敗する
  - 未使用かつ有効期限内であることを、`used_at` を条件に含めた UPDATE の更新件数で判定する
    （SELECT で確認してから UPDATE、という2段階にしない）
  - **参加人数もアプリ側で数えない。** `couple_members.slot` の
    `CHECK (slot IN (1,2))` と `UNIQUE (couple_id, slot)` で DB に担保させる。
    3人目は `slot = 3` を書こうとして CHECK 違反で失敗する
  - 招待の消費と参加の INSERT は `batch()` にまとめる。
    片方だけ成立する状態を作らない
  - 失敗回数を IP 単位で制限する（10回/時間）。超過で `RATE_LIMITED`
- オンボーディング画面
  - ペアが無いユーザーには「新しく作る」「コードで参加する」の2択を出す
  - コード表示画面には共有ボタンを置く（LINE 等に貼れる）

### `invite.accept` の実装方針

以下の形で成立する。SQL の細部は B が調整してよいが、
**「読んでから判断して書く」形にしないこと**と**制約違反が例外になること**は満たすこと。

```sql
-- 文1: 参加する（招待が未使用・期限内のときだけ行が入る）
INSERT INTO couple_members (couple_id, user_id, slot, joined_at)
SELECT i.couple_id,
       :userId,
       -- 空いている最小のスロット。両方埋まっていれば NULL になり NOT NULL 違反で失敗する
       (SELECT MIN(s.n)
          FROM (SELECT 1 AS n UNION ALL SELECT 2) s
         WHERE s.n NOT IN (SELECT m.slot
                             FROM couple_members m
                            WHERE m.couple_id = i.couple_id)),
       :now
  FROM invites i
 WHERE i.code = :code AND i.used_at IS NULL AND i.expires_at > :now;

-- 文2: 招待を消費する（条件は文1と揃える）
UPDATE invites SET used_at = :now
 WHERE code = :code AND used_at IS NULL AND expires_at > :now;
```

**文1と文2の WHERE 条件を揃えること。** 片方だけ期限を見ないと、
期限切れのコードを投げたときに参加は起きないのに `used_at` だけが刻まれる。
`used_at` の意味が「消費された」から「期限後に誰かが試した」に濁り、
総当たりの失敗試行で行を書き換えられる余地も残る。

**文1の結果を見て文2を止めることはできない。** `batch()` は2文をまとめて投げる。
「文1が0件なら文2を実行しない」という書き方をすると `batch()` ではなくなり、
2回の往復の間に隙間ができて原子性が失われる。
**2文とも必ず実行し、判定は文1の挿入件数と例外の有無で後から行う。**
だからこそ文2側にも条件を揃える必要がある。

この2文を `batch()` に入れる。**順序が重要**で、参加の INSERT を先に置く。
判定は次のとおり。

| 結果 | 意味 | 返すもの |
|---|---|---|
| 文1の挿入件数が 0 | コードが無効・期限切れ・使用済み | `NOT_FOUND` |
| `slot` の NOT NULL 違反 | ペアが既に2人（空きスロットが無い） | `FORBIDDEN` |
| `user_id` の UNIQUE 違反 | 既に別のペアに所属している | `FORBIDDEN` |
| 両方成功 | 参加成立 | couple |

#### この形にした理由

- **時刻を相関キーにしない。** 文1が `i.used_at IS NULL` を直接見るため、
  同じコードへの同時要求では後発の文1が0件になり、そのまま `NOT_FOUND` になる。
  「招待の消費を先に書いて、その書き込んだ時刻と照合する」形にすると、
  2つの要求が同一の `:now` を持った場合に照合が誤って一致する
- **スロットを件数から計算しない。** `COUNT(*) + 1` は行が削除されない前提に立っている。
  将来ペアの解散や退会を実装したとき、slot 1 が抜けた状態で
  `COUNT(*) + 1 = 2` が既存の slot 2 と衝突し、**正当な参加が
  「ペアが既に2人」として拒否される**。空きスロットを直接求めればこの前提が要らない

退会・解散は現時点で要件に無い（`requirements.md` 5節のスコープ外）。
それでもこの形にしておくのは、後から実装したときに**壊れ方が分かりにくい**ためである。

## セキュリティ上の必須事項
`docs/security-requirements.md` 4節に従う。**3点すべてを実装する。**

| 対策 | 内容 |
|---|---|
| 有効期限 | 24時間 |
| 同時発行数 | 1ペアにつき1件 |
| レート制限 | `invite.accept` の失敗を IP 単位で 10回/時間 |

## 確認観点
- 6桁が総当たり可能であることを踏まえ、3つの対策が確実に効いているか
- 1人が2つのペアに所属できないこと（`couple_members.user_id` の UNIQUE）
- 1ペアに3人目が入れないこと（`slot` の CHECK 制約で失敗すること）
- 同じコードを2回使えないこと
- **`db.transaction()` が使われていないこと**
- **「SELECT で数えてから書く」形になっていないこと。** 条件が書き込み文の WHERE に
  埋め込まれ、判定が更新件数か制約違反になっていること
- コードがログに出力されていないか

## 完了条件
- [ ] ペアを作り、招待コードを発行し、別アカウントで参加できる
- [ ] 制約3つ（1人1ペア / 1ペア2人 / コード1回限り）がテストで証明されている
- [ ] レート制限が動作する
- [ ] テストが緑
- [ ] **security-auditor の指摘で High 以上がゼロ**（招待を触るタスクのため必須）
- [ ] `artifacts/004/` に証跡を保存

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション

## 進捗
- [x] スキーマ + マイグレーション
- [x] `couple.create` / `couple.get` / `couple.update`
- [x] 招待コード生成（暗号論的乱数）
- [x] `invite.issue`（有効期限・同時1件）
- [x] `invite.accept`（原子的な使用済み判定・人数検査・レート制限）
- [x] オンボーディング画面(実機でのGoogleログイン確認は保留。下記実装メモ参照)
- [x] 制約3つのテスト
- [x] security-auditor 実行
- [x] 証跡保存 → `state.md` 更新 → `worklog.md` 追記

## 実装メモ(B)
- `invite.accept` はタスク定義の実装方針通り、`couple_members` へのINSERT
  (空きスロットへの `SELECT ... FROM invites`)と `invites.used_at` のUPDATEを
  `batch()` にまとめ、`?N` 形式のプレースホルダで named parameter の並び順に
  依存しない形にした
- レート制限は `invite_failures` テーブル(user_id + IP + created_at)を新設し、
  `invite.accept` の失敗時のみ記録する方式にした。Better Authの `rateLimit`
  (`storage: "database"`)は流用していない(L10とは別の実装で対応)
- **1回目のsecurity-auditorでHigh 1件・Medium 3件・Low 5件の指摘を受け、全て修正した。**
  レート制限キーをIPのみからuser_id併用に変更(IPv6ローテーション対策)、
  check→insertのTOCTOUを1文のSQLに統合、招待コードをWebのURLクエリに乗せない形に変更、
  招待コード文字集合の32文字→31文字化バグ(`L`の欠落)を修正、他。
  詳細は `artifacts/004/README.md` と `docs/security-report.md`
- オンボーディング画面はルート `_layout.tsx` で `couple.get` の結果
  (データあり→(tabs)、`NEEDS_ONBOARDING`→(onboarding)、未認証→(auth))で
  振り分ける形にした。005(認可ミドルウェア)で `ctx.coupleId` が導入されても
  この振り分けロジック自体は変わらない見込み
- **Google OAuthクライアント未設定のため、オンボーディング画面の実機確認(実際の
  ログイン→ペア作成→招待コード発行→別アカウントでの参加)は未実施。** 003のL14と
  同じ制約。API層のテスト(45件)でロジックは検証済み。詳細は `artifacts/004/README.md`
- 001の歩くスケルトンで作られた `packages/db/migrations/0000_init.sql` が
  コメントのみで実行可能な文を持たず、`wrangler d1 migrations apply` 相当の処理が
  失敗する実在のバグを発見・修正した(`artifacts/004/README.md` 参照)
