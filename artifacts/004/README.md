# 004: ペア作成と招待コード — 動作証跡

## 実行結果

- `pnpm --filter @futary/api test`: 52件全て緑（`api-test-results.txt` 参照。
  1回目の監査を反映した修正で7件追加）
  - `couple.test.ts`: couple.create/get/update の正常系・FORBIDDEN・NEEDS_ONBOARDING、
    付き合った日の範囲バリデーション（未来日・極端に古い日付）
  - `invite.test.ts`: invite.issue/accept の正常系、1人1ペア・1ペア2人・コード1回限りの
    3制約、期限切れ、レート制限（user_id/IP単位・10回/時間、IPローテーション耐性、
    IP欠落時の挙動、並行リクエスト20本での上限厳守）、招待コードの文字集合バリデーション
- `pnpm type-check`（ルート、全ワークスペース）: エラー無し
- `pnpm lint`（ルート）: エラー無し

## security-auditor 1回目の指摘と対応

1回目の監査で High 1件・Medium 3件・Low 5件が見つかり、全て修正した
（詳細は `docs/security-report.md`）。

| 重大度 | 指摘 | 対応 |
|---|---|---|
| High | レート制限がIPのみで、IPv6の/64ローテーションで無制限に回避できた | `invite_failures` に `user_id` を追加し、`user_id` と `ip_address` の**どちらか**が閾値を超えたら拒否する形に変更 |
| Medium | レート制限のcheck→insertがTOCTOU | 判定と記録を1文（`INSERT ... SELECT ... WHERE (SELECT COUNT ...) < ? RETURNING id`）に統合。並行リクエスト20本で NOT_FOUND 10件・RATE_LIMITED 10件ちょうどになることをテストで確認 |
| Medium | 招待コードがWeb版のURLクエリに露出（画面遷移パラメータ経由） | `invite.tsx` が自分でコードを発行するようにし、`create.tsx` からコードを渡さない形に変更 |
| Medium | 招待コード文字集合が実装コメント上32文字だが実際は31文字（`L`欠落）で剰余バイアスがあった | 文字集合に `L` を追加し32文字に修正 |
| Low | FORBIDDEN/NOT_FOUNDの出し分けがコード有効性のオラクルになっていた | invite.accept の失敗系を全て `NOT_FOUND` に統一 |
| Low | IP欠落時に共有バケットへ丸めて相互DoSの余地があった | IPが取れない場合は `user_id` 単独で判定 |
| Low | 招待コードの文字集合が入力スキーマで検証されていなかった | Zodスキーマに正規表現 `/^[2-9A-HJ-NP-Z]{6}$/` を追加 |
| Low | 付き合った日に範囲チェックが無かった | 1900-01-01〜今日(JST)の範囲チェックを追加 |

## security-auditor 2回目の指摘と対応

1回目の8件は全て解消を確認できたが、URL露出対策（「invite.tsx が自分でコードを
発行する」形）の副作用として新たにMedium1件・Low4件が見つかった。

| 重大度 | 指摘 | 対応 |
|---|---|---|
| Medium | 画面遷移だけで`invite.issue`が自動発行され、既に相手に渡した有効なコードが黙って無効化される（SameSite=Laxのため`/invite`へのリンクを踏ませるだけで反復妨害できる） | コード発行を `couple.create` 直後の一度きり（明示操作の一部）に限定し、`invite.tsx` は自動発行をやめて「招待コードを発行する」ボタンでのみ発行する形に変更 |
| Low | IP側のレート制限がuser_idと同じ閾値のORで、CGNAT配下で無関係な利用者を巻き込みうる | `user_id` は10回/時間のまま、`ip_address` は50回/時間に緩和し、両方を独立したAND条件で判定 |
| Low | IP欠落時に列へ`"unknown"`が実値として残る | `invite_failures.ip_address` をnullableにし、IP欠落時はNULLを書き込む形に変更 |
| Low | 掃除DELETEが`created_at`単独インデックスを持たず全表走査になる | 未対応（記録のみ）。想定規模ではテーブルが有界のため時期尚早と判断 |
| Low | `invite.issue`にレート制限が無い（再掲） | 未対応（記録のみ）。上記Medium修正で実質的なリスクは大きく下がったと判断 |

再監査後は追加のHigh/Mediumは無く、3回目の監査は実施していない。全詳細は `docs/security-report.md` を参照。

## 制約3つのテストでの証明箇所

| 制約 | テスト |
|---|---|
| 1人1ペア | `couple.test.ts`「既に別のペアに所属しているユーザーは作成できない」、`invite.test.ts`「既に別のペアに所属しているユーザーは参加できない」 |
| 1ペア2人 | `invite.test.ts`「1ペアに3人目は入れない（DBのCHECK/NOT NULL制約で失敗）」 |
| コード1回限り | `invite.test.ts`「同じコードを2回使えない」 |

## レート制限

`invite.test.ts`「invite.accept のレート制限（user_id/IP単位10回/時間）」で以下を確認：
- 同一IPからの失敗が10回を超えると `RATE_LIMITED`
- 別ユーザー・別IPからは制限されない
- 同一ユーザーはIPを変えても制限される（IPv6ローテーション対策）
- IPが取得できない場合はuser_id単位で制限され、他ユーザーを巻き込まない
- 並行リクエスト20本でもNOT_FOUND 10件・RATE_LIMITED 10件ちょうどになる（TOCTOU対策）
- 成功した試行はカウントされない（失敗のみカウント）

## 手動確認

- `apps/api`（wrangler dev）と `apps/app`（Expo Web）をローカルで起動し、
  未認証状態でトップページ（サインイン画面）が従来通り表示され、
  コンソールエラーが無いことを確認した（`_layout.tsx` のルーティングガード追加による
  リグレッションが無いことの確認）
- **オンボーディング画面（新しく作る／コードで参加する／招待コード表示）の実機確認は未実施。**
  Google OAuthクライアントが未設定のため実際のログインができず、003と同じ制約で
  保留とした（`docs/state.md` L14と同種の論点）。ログインが可能になり次第、
  実際にペア作成→招待コード発行→別アカウントでの参加までの一連を確認する

## 見つけて直した既存の不具合

- `packages/db/migrations/0000_init.sql` がコメントのみで実行可能なSQL文を含んでおらず、
  `wrangler d1 migrations apply` 相当の処理（テストで使う `readD1Migrations` も内部で
  同じ `wrangler` の `unstable_splitSqlQuery` を使用）が「SQL code did not contain a
  statement」で失敗することが判明した。無害な `SELECT 1;` を1文追加して解消した
  （001の歩くスケルトンで作られたファイルだが、本番の `wrangler d1 migrations apply`
  でも同様に失敗する実在のバグだったため004内で修正した）

## テスト実行時に判明した設定不足

`@cloudflare/vitest-plugin` はテスト用D1にマイグレーションを自動適用しないため、
`apps/api/vitest.config.ts` に `readD1Migrations` / `applyD1Migrations` を使った
セットアップ（`apps/api/test/apply-migrations.ts`）を追加した。
これまでのテスト（health/me/auth/cors）はテーブルに触れていなかったため気づかれていなかった。
