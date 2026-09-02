# 029: 気分の記録 — security-auditor 監査結果（生ログ）

### [2026-09-02] 監査対象: タスク029「気分の記録」（mood 手続き・moods スキーマ・me.delete 変更・mood 画面）

| 重大度 | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| Low | `apps/api/test/authorization.test.ts:966-968` | 「認可の基底を経由しない手続きが無い」テストの番人が `toBeGreaterThanOrEqual(26)`（コメントも「028時点 … = 26」）のまま。029 で mood 3本が増えて実数は 29 になっているが下限が更新されていない | 下限を 29 に、コメントを「029時点: … + wish 5 + mood 3 = 29」に更新する |
| Low | `apps/api/src/procedures/me.ts:177` / `packages/db/src/schema/mood.ts:17-19` | `me.delete` の moods 削除は `WHERE couple_id = ?1` のみ。`moods.user_id` は `user(id)` を ON DELETE no action で参照するため、`DELETE FROM user` が成立するのは「そのユーザーの moods 行が必ず自分の現ペアにしか無い」という不変条件（`couple_members.user_id` が UNIQUE）に依存している。現状は到達不能だが、将来「ペア解消／退会せずにペアだけ抜ける」を実装する場合、`couple_members` を消すのと同じ文で `moods`（および同じ構造の `reactions`）も消す必要がある | 現時点の修正は不要。設計メモとして記録し、将来の機能実装時にAへ引き継ぐ |
| Low | `packages/contract/src/mood.ts:5-6` | `dateSchema` が正規表現のみで、`@futary/date` の `isValidDate` を通していない（`event.list` と同じ既存の形。mood固有の退行ではない）。上界・越境は実害なしと確認済み | 直す場合は mood 単独ではなく `dateSchema` を共通化して event/mood 両方に対応する |

### 特に確認を依頼された7点の判定（すべて指摘なし）

1. **user_idを引数に取らない**: 確認済み。setToday/clearTodayの入力は`{level}`/なしのみ。`context.userId`のみを使用。他人の分を書き換える経路は構造的に存在しない
2. **couple_idスコープと認可基盤の経由**: 確認済み。3本すべてreadProcedure/writeProcedureを経由し、SQLすべてに`couple_id = ?1`。他ペアの気分が漏れる経路は見つからなかった
3. **ゲストの書き込み拒否**: 確認済み。writeProcedureがreadonlyモードをFORBIDDENで弾く。UIだけでなくサーバ側が独立して拒んでいる
4. **me.deleteのDELETE順序**: 確認済み。027の轍は踏んでいない。moodsはwishesの直後、invites/couple_members/couplesより前、同一db.batch()内
5. **levelの範囲チェック**: Zod（`.int().min(1).max(5)`）とDB（名前付きCHECK `moods_level_range_check`）の両方にあり、手続き経由・直接INSERT・スキーマ作り直しの3方向でテスト済み
6. **T9/キャッシュキー**: 確認済み。mood.listの2箇所とも`viewerKey`をqueryKeyに含めており、readProcedure経由のためviewer-key-coverage.test.tsの走査に自動的に載る
7. **物理削除の設計判断**: 矛盾なし。reactionsという同じ形の先例があり、論理削除を持つのはposts/wishesのみ。architecture.mdに理由付きで記録済み

### その他（セキュリティ影響なし・参考）

`apps/app/app/(tabs)/mood.tsx`の`todayDate`はマウント時に一度だけ固定される。アプリを開いたままJSTの日付を跨ぐと表示がずれる可能性があるが、サーバ側は常に実際の「今日」を対象にするため、他の日の記録が消える等の実害は無い。

### 総評

**High/Critical の指摘なし。**最優先観点（水平権限昇格・デモ経路・T9）はいずれも既存の防御線に正しく載っており、mood固有の迂回路は作られていない。027で踏んだme.deleteのFK違反も再発していない。

## 対応

- Low 1件目（番人の下限値）: `apps/api/test/authorization.test.ts`で26→29に修正済み
- Low 2件目（user_id側FKの将来リスク）: 設計メモとしてこのファイルに記録。将来「ペア解消」機能実装時に参照すること
- Low 3件目（dateSchemaの実在日付チェック）: event.listと共通の既存パターンであり、mood単独では対応しない
