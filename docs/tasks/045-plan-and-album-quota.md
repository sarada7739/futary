# 045: プランの印と、アルバムの無料枠

## 目的

**人間の指示。アルバムに入れられる写真の枚数を無料では制限し、有料に解放したい。決済はあとで。まず印だけ作る。**

- ペアに **プラン（`free` / `paid`）** を持つ。当面は運営が手で切り替える
- **無料の制限は「ペア全体で、作ったアルバムに入れた写真の合計枚数」**（人間の決定）。アルバムの数は制限しない。タイムラインは対象外
- **決済（Stripe 等）は次のタスク。**今回のテーブルに行を書くだけで済む形にしておく

## 0. 先に決めたこと（A）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | 印をどこに持つか | **新しい表 `couple_plans`**（ペアごとに 0〜1 行）。`couples` に列を足さない | 決済が来たとき、購読 ID・期限・出どころを同じ行に足せる。`couples` は子表を持つので CHECK もあとから足せない（`architecture.md` 4節）。**行が無ければ free** |
| 2 | 無料枠の数 | **30 枚**（仮。定数 `FREE_ALBUM_PHOTO_LIMIT`。環境変数にしない） | 「お試し」に足りて、「使い続ける」には足りない数。あとから変えるのは定数 1 つ |
| 3 | 何を数えるか | **未削除のアルバムに入っている `album_photos` の行数（ペア全体）** | 削除すれば枠が戻る。タイムライン（`post_images`）は数えない |
| 4 | 超えたとき | `album.create`（cover あり）・`album.addPhotos` を **`PLAN_LIMIT`**（新しいエラー。409）で拒む。**1 枚も入れない** | `LIMIT_REACHED`（500 枚・100 件の物理上限）と分ける。画面が「プランの話」と分かる必要がある |
| 5 | 既に枠を超えている分 | **消さない。見られる。**足せないだけ | 制限は追加に掛ける。持ち物を取り上げない |
| 6 | 有料の上限 | 今までどおり（1 アルバム 500 枚・100 件）。プランでは制限しない | 物理上限は別の話 |
| 7 | 画面の文言 | 「無料プランでは 30 枚まで」。超えたら「もっと保存するには有料プランが必要です。**有料プランは準備中です**」 | 決済がまだ無い。買えないものを「買ってください」と言わない |
| 8 | 切り替えの手段（当面） | **運営が D1 に行を書く**（下記 1節の SQL）。画面からは変えられない | 決済が来るまでの暫定。管理画面は作らない |
| 9 | デモペア | **`paid` の行を入れる**（シード） | ゲストは書けないので制限は効かないが、「無料プランでは…」の表示をデモに出さない |
| 10 | リリース履歴 | **入れない**（新機能ではなく制限。載せるなら人間が言う） | 043 の規約の例外 |
| 11 | ゲストにも `plan` を返すか | 返す（デモは `paid`） | 画面の分岐を 1 つにする |
| 12 | 人間（運営）のペア | **デプロイ後すぐ `paid` にする**（1節の SQL。人間の許可を取って B が実行するか、人間が実行） | 人間と相手は制限なしで使う（人間の指示）。free の動作確認は、paid にする前に 1 度だけ見る |

## 1. データモデル

```sql
CREATE TABLE couple_plans (
  couple_id   TEXT PRIMARY KEY REFERENCES couples(id),
  plan        TEXT NOT NULL,                 -- 'free' | 'paid'。未知の値は free として扱う（サーバ）
  source      TEXT NOT NULL DEFAULT 'manual',-- 'manual'（運営が手で）| 将来 'stripe'
  expires_at  INTEGER,                       -- NULL = 無期限。非 NULL で過ぎていれば free として扱う
  updated_at  INTEGER NOT NULL
);
```

- **行が無い = free。**`SELECT` して無ければ free。JOIN で `LEFT JOIN` にする
- **CHECK は持たない**（027・040・041 と同じ）。`plan` の判定は `plan = 'paid' AND (expires_at IS NULL OR expires_at > now)` の 1 箇所（`lib/plan.ts` の `resolvePlan(row, now)`）。**それ以外は全部 free**
- `me.delete` は `couple_plans` の行を消す（`architecture.md` 4節「表を足したら、消す手順にも足す」）。`couples` の行より先
- **切り替え（運営）**:
  ```bash
  pnpm --filter @futary/api exec wrangler d1 execute futary --remote \
    --command "INSERT INTO couple_plans (couple_id, plan, source, updated_at) VALUES ('<coupleId>', 'paid', 'manual', unixepoch()) ON CONFLICT(couple_id) DO UPDATE SET plan = 'paid', updated_at = unixepoch()"
  ```
  free に戻すのは `plan = 'free'` で同じ文。**人間の許可を取ってから**（本番の D1 に書く）。B はこの文を `artifacts/045/` に置いて、ローカルで通ることを確かめる

## 2. 契約

| 手続き | 変更 |
|---|---|
| `couple.get` | 返り値に **`plan: "free" \| "paid"`** と **`albumQuota: { limit: number, used: number } \| null`**（paid なら `null`）を足す。**T9 の対象**（既存） |
| `album.list` / `album.get` | **変えない。**枠は `couple.get` から取る（2 箇所に持たない） |
| `album.create` / `album.addPhotos` | free で `used + 追加枚数 > limit` なら **`PLAN_LIMIT`**（409）。**1 枚も入れない**。`LIMIT_REACHED` の検査より先に見る |
| その他 | 変えない。`removePhotos`・`delete`・閲覧・保存は制限しない |

- `used` は `couple_id` の未削除アルバムの `album_photos` を **1 文で数える**（`albums.deleted_at IS NULL` を JOIN に含める）
- 数えてから書くまでの間に相手が足すと超えうる（D1 にトランザクションは無い）。**数枚の超過は許す**（物理上限と違い、超えても壊れない。`architecture.md` 4節「読んでから判断して書く形にしない」の例外として結果に書く。厳密にするなら WHERE に埋めた INSERT … SELECT になるが、ここでは要らない）

## 3. 画面

### アルバム詳細（`album-detail.tsx`）

- free のとき、**FAB の近くに 1 行**「無料プランでは 30 枚まで（あと 4 枚）」（`albumQuota` から）。paid なら出さない
- **残りが 0 のとき FAB を押す**と、選ぶ前にシート: 「無料プランでは 30 枚まで保存できます。もっと保存するには有料プランが必要です。有料プランは準備中です。」「閉じる」。**写真を選ばせない**
- 残りが n 枚で n+1 枚以上選んだ → 送る前に「あと n 枚まで入れられます」の 1 行で止める（`PLAN_LIMIT` を待たずに画面で先に見る。サーバでも拒む）
- サーバが `PLAN_LIMIT` を返したら（相手が同時に足した等）同じシート
- 作成モーダルの「カバー写真を選択」も同じ（残り 0 なら選ばせず、上のシート）

### 一覧（`album.tsx`）

- 出さない（詳細で足すときに見えれば足りる）

### マイページ（`profile.tsx`）

- 「プラン: 無料」「プラン: 有料」の 1 行（`couple.get` の `plan`）。押せない。**設定項目ではなく表示だけ**。決済が来たらここが入口になる

### 文言

- 「無料プラン」「有料プラン」。「トライアル」「お試し」は使わない（期限が無いので）
- 数字は定数から出す（文言に 30 を直書きしない）

## 4. やらないもの

| | 扱い |
|---|---|
| 決済（Stripe Checkout・Webhook） | **次のタスク。**`couple_plans` に `source='stripe'`・`expires_at` を書く形になる |
| 管理画面 | しない。D1 に手で書く（0節 #8） |
| アルバムの数・タイムライン・保存（ダウンロード）の制限 | しない |
| 超過分の削除・非表示 | しない（0節 #5） |
| 個人単位のプラン | しない。ペア単位（アルバムはペアの持ち物） |
| リリース履歴 | 入れない（0節 #10） |

## 5. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| T1 | free で 30 枚入っている状態で `addPhotos`（1 枚）→ `PLAN_LIMIT`、行も R2 も増えない。29 枚で 2 枚 → `PLAN_LIMIT`（1 枚も入れない）。29 枚で 1 枚 → 入る | `apps/api` |
| T2 | `album.create`（cover あり）も同じ | `apps/api` |
| T3 | paid（行あり・期限なし）→ 31 枚目が入る。`expires_at` が過去 → free 扱い。`plan` が未知の文字列 → free 扱い | `apps/api` |
| T4 | `used` は削除済みアルバムの写真を数えない。タイムライン（`post_images`）を数えない。別ペアの写真を数えない | `apps/api` |
| T5 | `couple.get` が `plan`・`albumQuota` を返す（free: `{limit:30, used:n}`、paid: `null`）。既存の viewerKey の検査が拾う | `apps/api`・`apps/app` |
| T6 | `me.delete` が `couple_plans` を消す（既存の削除の網が新しい表を拾うことを確かめる。032） | `apps/api` |
| T7 | 画面: free で残り 0 のとき FAB でシートが出て写真を選ばない。残り 2 で 3 枚選ぶと 1 行で止まる。paid では枠の行が無い | `apps/app` |
| T8 | マイページに「プラン: 無料／有料」 | `apps/app` |
| T9 | マイグレーションの実体とファイル（`schema-integrity`）が `couple_plans` を拾う | `packages/db` |

## 確認観点

- 本番の自分のペア（行なし = free）で 30 枚を超えて足せない。文言が出る
- 運営の SQL で `paid` にすると足せる（人間の許可を取って 1 回）
- デモ（ゲスト）に「無料プランでは…」が出ない

## 完了条件

- T1〜T9 が緑。`pnpm -r test`・型チェック・lint
- `artifacts/045/`: 切り替えの SQL がローカルで通った記録・スクリーンショット（両モード × 枠の行・シート・マイページ）
- 人間の実機: free で止まる（1 度だけ見る）→ **人間のペアを paid にして**通る。以後 paid のまま
- `state.md` / `worklog.md`

## 停止条件

- `couple.get` に足すと既存の画面テストが大量に赤になる（`couple.get` のモックの形） → 直し方を結果に書いて進む。A の手番は要らない
- `me.delete` の順序で FK に当たる → 止まる（`architecture.md` 4節を読んでから）
- 30 枚の数え方で `album_photos` に索引が要る（`album_id` からの JOIN で足りるはず）→ 足して結果に書く

## 順序

044 の後。042 の上限 50 は後回しのまま。決済は 045 の受け入れ後に人間が「入れる」と言ってから起票する。
