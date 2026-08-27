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
-- 文1: 招待を消費する（未使用・期限内のときだけ更新される）
UPDATE invites SET used_at = :now
WHERE code = :code AND used_at IS NULL AND expires_at > :now;

-- 文2: 参加する（文1で消費できたときだけ行が入る）
INSERT INTO couple_members (couple_id, user_id, slot, joined_at)
SELECT i.couple_id, :userId,
       (SELECT COUNT(*) + 1 FROM couple_members m WHERE m.couple_id = i.couple_id),
       :now
FROM invites i
WHERE i.code = :code AND i.used_at = :now;
```

この2文を `batch()` に入れる。判定は次のとおり。

| 結果 | 意味 | 返すもの |
|---|---|---|
| 文1の更新件数が 0 | コードが無効・期限切れ・使用済み | `NOT_FOUND` |
| CHECK 制約違反 | ペアが既に2人 | `FORBIDDEN` |
| `user_id` の UNIQUE 違反 | 既に別のペアに所属している | `FORBIDDEN` |
| 両方成功 | 参加成立 | couple |

文2が `i.used_at = :now` を条件にしているため、
文1が消費できなかった場合は文2も行を入れない。TOCTOU が発生しない。

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
- [ ] スキーマ + マイグレーション
- [ ] `couple.create` / `couple.get` / `couple.update`
- [ ] 招待コード生成（暗号論的乱数）
- [ ] `invite.issue`（有効期限・同時1件）
- [ ] `invite.accept`（原子的な使用済み判定・人数検査・レート制限）
- [ ] オンボーディング画面
- [ ] 制約3つのテスト
- [ ] security-auditor 実行
- [ ] 証跡保存 → `state.md` 更新 → `worklog.md` 追記
