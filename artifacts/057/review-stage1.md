# 057（PR #402）— R の判定

futary-R で 355a297 を checkout して実行した（`.dev.vars` は CI と同じダミー。`ADMIN_EMAILS=ci-admin@example.com` も）。ui 16・date 67・db 32・app 588・api 749 全部緑。`tsc --noEmit` 緑・`eslint .` 緑。CI pass。`pnpm generate`（drizzle-kit）は「No schema changes」。`worklog.md` は追記のみ。触ったものは戻した。

**判定: 受け入れ。必須修正なし。**

## 壊して確かめたこと（`admin` + `authorization` + `couple` 114 本）

| 壊し方 | 赤 |
|---|---|
| `adminProcedure` で認証済みなら誰でも通す | 1 本（T1） |
| `source='stripe'` の行も上書き | 1 本（T4） |
| `admin_actions` に書かない | 2 本（T4） |
| `stats` でデモを除かない | 1 本（T2） |
| メールの比較で小文字化・trim しない | 2 本（T1） |
| `lookup` のペアの投稿数で `couple_id` を切らない | 1 本（T6） |
| **`lookup` の handler が `name` を返す** | **緑**（記録 1。契約が剥がす） |
| **free に戻すとき `updated_at` を更新しない** | **緑**（記録 2） |

## 読んで確かめたこと

- 0節 #1・#2: 判定は `middleware/auth-context.ts` の `resolveIsAdmin` 1 箇所（認証済み + `ADMIN_EMAILS` に小文字化・trim で含まれる）。`admin.*` 4 つ全部 `adminProcedure`（`authorization.test.ts` が「必ず経由」を固定）。`ADMIN_EMAILS` 未設定は空 = 運営なし
- **メールを利用者が書き換える経路が無いこと**: `me.update` の入力は `name`・`imageId` だけ。Better Auth の `changeEmail` は既定の無効のまま（`auth.ts` に設定無し）。ログインは Google だけ。運営のメールを名乗って `isAdmin` になる道は無い
- 線（数と `couple_plans` の 1 行だけ）: `lookup` の SQL は `COUNT` と `couple_plans` の列だけを読む（`posts.body`・`user.name`・`albums.title`・記念日・画像の key は SELECT に無い）。`admin.actions` は `admin_actions` + `user.email`（運営の）だけ
- 0節 #5・#6: `computeStats` は `db.batch` の 6 文。デモは `is_demo = 0`（利用者は `NOT EXISTS` で除く）。削除済みは数えない。paid は `resolvePlan`。今日 = JST 0:00・7 日平均 = 今日を含まない直近 7 日 ÷ 7（小数 1 桁）
- 0節 #8・#9: `setPlan` は `source='manual'`・paid は `expires_at NULL`・free は `updated_at` を今（047 の起点）。`stripe` は CONFLICT で行も記録も変わらない。`stripe_customer_id` は upsert で消えない
- 0節 #10・#15: `admin_actions`（ULID・FK 無し・`created_at` 索引）に `db.batch` で同時に書く。ログは `action=<ULID> couple=<8 文字> plan=`（メール無し）
- 0節 #11: 1 分キャッシュ（isolate ごと）。0節 #3: `href: null`・マイページの「運営 ›」は `isAdmin` だけ
- T8: `admin_actions` は `me.delete` の網で「残す」側。`adminEmail` は退会なら null（LEFT JOIN）

## 記録（判定に使わない）

1. `lookup` の handler に `name` を足しても T3 が緑なのは、**契約の output schema（zod）が知らないキーを剥がす**ため。本当の線は `packages/contract/src/admin.ts` の出力の形で、T3 はその形をキーで固定している。契約に足せば T3 が拾う。設計どおりで問題ないが、線の置き場は契約だと知っておく
2. T4「paid → free で `updated_at` が今」は、`ON CONFLICT` の `updated_at = ?3` を外しても緑（前の行の `updated_at` と同じ秒で作られるので区別がつかない）。時刻を進めて（または `updated_at` を過去に置いてから）free に戻すと拾える。047 の猶予の起点なので、1 本あるとよい。任意
3. `setPlan` はデモペアにも掛かる（害は無い）

## 私が確かめていないこと

- 人間の手番（`ADMIN_EMAILS` の secret・本番で自分を探して free → paid）
- スクリーンショットは `capture.json` の文言を読んだだけ
