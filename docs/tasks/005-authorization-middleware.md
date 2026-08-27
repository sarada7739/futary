# 005: 認可ミドルウェア

## 目的
**このアプリの認可の要となるタスク。** `couple_id` の解決を1箇所に集約し、
手続きごとに認可を書かなくてよい状態にする。
手続きごとに書くと、必ずどこかで書き忘れて他ペアのデータが漏れる。

## 変更対象ファイル
- （新規）`apps/api/src/middleware/auth-context.ts`
- （新規）`apps/api/src/procedures/base.ts` — 認証必須/読み取り専用可 の基底手続き
- `apps/api/src/procedures/couple.ts` — 既存手続きを基底手続きの上に載せ替える
- （新規）`apps/api/test/authorization.test.ts`

## 実装内容

### ミドルウェアの動作
```
1. セッションを取得する
2. 認証済み  -> couple_members から couple_id を解決する
                 未所属なら NEEDS_ONBOARDING を返す
   未認証    -> couple_id = env.DEMO_COUPLE_ID、mode = 'readonly'
3. mode が 'readonly' かつ書き込み系の手続き -> FORBIDDEN
4. ctx に { userId | null, coupleId, mode } を載せる
```

### `DEMO_COUPLE_ID` がまだ存在しないことへの対処

**デモペアを作るのは 014 である。005 の時点では存在しない。**

`DEMO_COUPLE_ID` が未設定、または空文字の場合は、
**未認証アクセスをその場で拒否する**（`FORBIDDEN`）。

- `ctx.coupleId` に `undefined` や `null` を入れて先へ進めない。
  未定義の値でクエリを組み立てると、条件が意図せず外れて
  **全ペアのデータが返る**形になり得る
- 「設定されていないから制限しない」ではなく「設定されていないから通さない」
  （fail-closed）にする。014 でデモペアを作った時点で自然に通るようになる

この分岐もテストで検証する（`DEMO_COUPLE_ID` 未設定時に未認証の読み取りが拒否されること）。

### 基底手続きの分離
- `readProcedure` — 読み取り。未認証（デモ）でも通る
- `writeProcedure` — 書き込み。`mode === 'readonly'` なら `FORBIDDEN`
- 以降の全手続きは、必ずこのどちらかの上に載せる

### 絶対に守る規則
- **手続きの入力スキーマに `coupleId` を含めない。** クライアントから受け取らない
- 全てのクエリに `couple_id = ctx.coupleId` を含める
- 単一レコードの更新・削除は WHERE 句に `couple_id` を含めて1文で行う
  （SELECT で所有者を確認してから UPDATE、という2段階にしない）

## テストで証明すること（`docs/security-requirements.md` 3節）

| # | 内容 |
|---|---|
| 1 | ペアAのユーザーがペアBのレコードIDを指定しても取得・更新・削除できない |
| 2 | 未認証アクセスで書き込み系の手続きが全て `FORBIDDEN` になる |
| 3 | 未認証アクセスで読み取れるのがデモペアのデータのみである |
| 4 | ペアに未所属のユーザーが呼ぶと `NEEDS_ONBOARDING` になる |
| 5 | `DEMO_COUPLE_ID` が未設定のとき、未認証の読み取りが拒否される（fail-closed） |

このテストは以降の全タスクで維持される。壊れたら実装が間違っている。

## 確認観点
- `coupleId` を入力に持つ手続きが1つも存在しないか（grep で確認できるか）
- `readProcedure` / `writeProcedure` を経由しない手続きが無いか
- テスト5件が実際に「拒否されること」を検証しているか（成功パスだけ書いていないか）

## 完了条件
- [ ] ミドルウェアが動作し、既存手続きが基底手続きの上に載っている
- [ ] 上記テスト5件が緑
- [ ] テスト全体が緑
- [ ] **security-auditor の指摘で High 以上がゼロ**（認可を触るタスクのため必須）
- [ ] `artifacts/005/` にテスト結果を保存

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション
- **この時点で M1 完了。人間による受け入れ判定を行う。**

## 進捗
- [ ] ミドルウェア実装
- [ ] `readProcedure` / `writeProcedure`
- [ ] 既存手続きの載せ替え
- [ ] 認可テスト5件（DEMO_COUPLE_ID 未設定時の fail-closed を含む）
- [ ] security-auditor 実行
- [ ] 証跡保存 → `state.md` 更新 → `worklog.md` 追記
- [ ] 人間へ M1 受け入れ判定を依頼
