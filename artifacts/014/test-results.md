# 014: ゲスト・デモ体験 テスト結果

## 単体・結合テスト

| パッケージ | 件数 | 結果 |
|---|---|---|
| `packages/db`（新規。シード生成ロジック） | 17件 | 全緑 |
| `apps/api` | 296件 → 297件（+1） | 全緑 |
| `apps/app` | 133件 → 135件（+2） | 全緑 |

（security-auditorの指摘対応で `packages/db` は16件→17件に増えた。`is_demo`が
1になっていることを確認するテストを追加）

型チェック・lintともに通過（`pnpm -r type-check`・`pnpm lint`）。

## マイグレーション（0013_event_repeat_yearly_check.sql）

- `events` に `events_repeat_yearly_check` CHECK制約を追加（`repeat_yearly=1` は `kind='anniversary'` のときだけ許可。R が実測したとおり、018で入れたつもりで実際には入っていなかった制約）
- 生成されたSQLに `CREATE INDEX` が2本入っていることを目視確認済み（`events_couple_date_idx`・`events_meetup_unique`）
- ローカルD1（空の状態）に適用前、CHECK違反行を数えた: `SELECT COUNT(*) FROM events WHERE repeat_yearly=1 AND kind<>'anniversary'` → **0件**（ローカルD1はこの時点で空だったため自明）。本番投入（016）の直前に本番D1でも同じクエリを実行し、件数を記録すること
- `apps/api/test/schema-integrity.test.ts` の期待値一覧に `events_repeat_yearly_check` を追加
- `apps/api/test/migration-existing-rows.test.ts` に0013用のケースを追加（`repeat_yearly=1`のanniversaryと`repeat_yearly=0`のmeetupが表の作り直しを生き延びること、かつ制約自体が効いていることを確認）

## デモシード（`packages/db/seed/`）

ローカルD1・R2へ実投入して確認済み（`pnpm --filter @futary/db run seed:local`）。

| 項目 | 実測値 |
|---|---|
| meetup | 94件（80〜100の範囲内） |
| plan | 6件（5〜8の範囲内。未来日を含む） |
| anniversary | 4件（3〜5の範囲内） |
| 投稿 | 43件（30〜50の範囲内） |
| うち画像付き | **4件**（目安は5〜8件だが、使える写真が4枚しか無い。下記security-auditor指摘を参照。同じ画像は使い回していない） |
| リアクション | 34件 |

**2回連続で実行し、2回目も成功。** 冪等性を確認済み（`packages/db/seed/README.md`参照。既存のデモペア行を外部キー順に削除してから作り直す）。

未認証（`wrangler dev --local`）でoRPCエンドポイントを直接叩いて確認:

```
couple.get  -> datingDate: "2025-02-17"（今日から約561日前）
stats.get   -> daysTogether: {status:"dating", days:561}, meetupDays:94, postCount:43, photoCount:4
memory.get  -> oneMonthAgoの投稿（画像付き）を正しく返す
event.list  -> meetup/plan/anniversaryが期間内に混在し、createdByNameが両ユーザーに振り分けられ、
               startTime/endTimeの有無が混ざっている
post.list   -> リアクション件数付きで投稿一覧が返る
post.create -> FORBIDDEN（未認証の書き込み拒否。既存のミドルウェアが機能）
```

## 認可のテスト（security-requirements.md 3節 項目1〜8）

新しいシードやゲストUIのために新規テストは追加していない。既存の `apps/api/test/authorization.test.ts` が
`createDemoCouple`ヘルパー（テスト内で`is_demo=1`の行を直接作る）を使って項目1〜8（未認証の書き込み拒否・
デモペアのみ読み取り可能・`DEMO_COUPLE_ID`未設定/非デモペア指定時の拒否 等）を既に検証しており、
014が新設したのは実際にDEMO_COUPLE_IDへ実在の値（`demo-couple`）が入ったことだけである
（`apps/api/wrangler.toml`）。ミドルウェア本体（`resolveCoupleContext`）は変更していない。

## security-auditor監査

**High/該当なし。Medium 3件・Low 4件（すべて実装で対応済み）。**

| 重大度 | 指摘 | 対応 |
|---|---|---|
| Medium | シードの破壊的DELETE（`buildDeleteSql`）が`is_demo=1`を確認せずに固定ID条件だけで実行される。`DEMO_COUPLE_ID`が誤って実在の非デモペアを指した状態で流すと、書き込み間違い1つで**復旧不能な削除**になる（読み取り側`resolveCoupleContext`は`AND is_demo=1`で守られているのに、削除側は守られていなかった） | `run.ts`に`assertSafeToOverwrite()`を追加。対象IDが存在し`is_demo≠1`なら例外を投げて中断し、D1変更・R2アップロードのどちらにも進ませない。**実際に非デモペアを装った状態を作って中断することを確認済み**（下記） |
| Medium | 上記と同根で、R2への画像アップロードも無条件に上書きする | `applySql`が例外を投げた時点で`main()`が止まり`uploadImages`へ進まない構造にした（コード上、ガードを通らない限り呼ばれない） |
| Medium | `packages/db/seed/assets/`（旧`meetup-3.jpg`。原本`docs/sample/風景/Y5dn1UKP.jpg`）に、実在しそうな店名の看板「Café de lumière」と営業時間が明瞭に写り込んでいた。`docs/sample/README.md`が`eHaCqEMx.jpg`を同じ理由で除外しているのに、この1枚は見落としていた | 画像を実際に開いて確認し、該当ファイルを差し替え。使用する風景写真を5枚→4枚に変更し、`docs/sample/README.md`・`packages/db/seed/README.md`へ記録した。写真付き投稿は目安の5〜8件ではなく4件になる（安全側を優先） |
| Low | `/compose`をWebで直接開くとゲスト閲覧中でもフォームが開く（FAB等の導線は塞いだが直接URL遷移は素通り）。サーバ側は`writeProcedure`がFORBIDDENにするため実害はない | `compose.tsx`にも`useGuestMode()`のガードを追加し、他4画面と同じログイン導線にした |
| Low | 0013マイグレーションは、新CHECKに違反する既存行がリモートに1件でもあると表の作り直し中に失敗し、`d1_migrations`未記録のまま再実行不能になりうる | マイグレーションファイル冒頭に、リモート適用前に件数を数える手順（違反時のUPDATE文つき）をコメントで明記した |
| Low | デモユーザーが`email_verified=1`で作られている。到達不能性は`@example.com`（予約ドメイン）だけに依存していた | `email_verified=0`に変更。到達不能性を1つの前提に集約しない |
| Low | `wrangler.toml`の`DEMO_COUPLE_ID`と`demo.ts`の定数が一致していることを検査するテストが無く、`is_demo`を落としても全テストが緑のままになりうる（fail-closedなのでデモが映らなくなるだけで漏洩はしない） | `demo.test.ts`に`couples`のINSERT文で`is_demo`が`1`であることを確認するテストを追加 |
| （情報） | 画像の寸法を一律`1536x1024`と決め打っていたが、実際には縦長の画像（`meetup-1.jpg`）が混ざっていた（セキュリティではなく実装の誤り） | `MEETUP_PHOTOS`を`{file, width, height}`の配列にし、画像ごとの実寸を持たせた |

**指摘なしを確認した点**: T4（デモ経路からの本番データ漏洩）に関わる`resolveCoupleContext`・`writeProcedure`は014で変更していない。シードスクリプトの
SQL文字列組み立ては外部入力を一切持たずインジェクション経路が無い（`run.ts`は`execFileSync`でシェルを経由しない）。シード画像7枚すべてを実際に開いて
確認し、除外指定の看板2枚（`eHaCqEMx.jpg`・今回追加の`Y5dn1UKP.jpg`）以外に実在の人物・商標・地名は含まれない。ゲストモードの状態（`lib/guest-mode.ts`）は
描画の分岐にのみ使われ、認可判断やサーバへのリクエストには一切影響しない。

### ガードの動作確認（Medium対応の検証）

ローカルD1で`demo-couple`をいったん`is_demo=0`の実ペアに偽装し、シードを実行して中断することを確認した:

```
Error: DEMO_COUPLE_ID（demo-couple）が is_demo=1 でないペアを指しています。
このまま進めると実ペアのデータを削除・上書きすることになるため中断します。
```

中断時、D1への削除・R2へのアップロードのどちらも実行されなかった（ログに"Creating object"が1件も出ていないことを確認）。
その後、偽装データを取り除いて再度シードを実行し、正常に投入できることも確認した。
