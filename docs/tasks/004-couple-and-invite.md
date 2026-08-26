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
  - 未使用かつ有効期限内であることを、`used_at` を条件に含めた UPDATE の更新件数で判定する
    （SELECT で確認してから UPDATE、という2段階にしない）
  - トランザクション内で参加人数を検査し、既に2人なら拒否する
  - 失敗回数を IP 単位で制限する（10回/時間）。超過で `RATE_LIMITED`
- オンボーディング画面
  - ペアが無いユーザーには「新しく作る」「コードで参加する」の2択を出す
  - コード表示画面には共有ボタンを置く（LINE 等に貼れる）

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
- 1ペアに3人目が入れないこと
- 同じコードを2回使えないこと
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
