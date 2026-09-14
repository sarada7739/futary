# 045: プランの印と、アルバムの無料枠 — 実装の報告

2026-09-14 / セッションB。タスク定義（`docs/tasks/045-plan-and-album-quota.md`。A が 3節を絵に合わせて書き直した 7acd737 の版）に従って実装した。
人間の実機（free で止まる → 人間のペアを paid にして通る）はデプロイ後。**人間のペアを paid にする SQL は `plan-switch.md`。本番の D1 に書くので人間の許可を取ってから。**

## 作ったもの

### データ（`packages/db`）

- `src/schema/couple.ts`: `couplePlans`（`couple_plans`。couple_id PK → couples・plan・source DEFAULT 'manual'・expires_at・updated_at。CHECK なし）
- `migrations/0023_couple_plans.sql` + `meta/0023_snapshot.json`（`pnpm db:generate` で生成。ファイル名は `0023_chemical_devos` → `0023_couple_plans` に改名し `_journal.json` の tag も揃えた。CI の「generate で新しいファイルが出ない」検査はそのまま通る）
- `seed/demo.ts`: デモペアに `couple_plans` の paid の行を入れる（couples の直後）。DELETE の並びに `couple_plans` を足した（albums のあと・invites の前）。`demo.test.ts` に順序と paid の INSERT の検査

### 契約（`packages/contract`）

- `couple.ts`: `PLAN_VALUES`・`FREE_ALBUM_PHOTO_LIMIT = 30`・`albumQuotaSchema`・`coupleWithPlanSchema`（`coupleSchema` + `plan` + `albumQuota`）。**`couple.get` の出力だけ**を `coupleWithPlanSchema` にした（create / update は変えない）
- `album.ts`: `album.create`・`album.addPhotos` に `PLAN_LIMIT: { status: 409 }`

### サーバ（`apps/api`）

- `src/lib/plan.ts`: `resolvePlan(row, now)`（判定の 1 箇所）・`loadPlan`・`countAlbumPhotosUsed`（`album_photos` JOIN `albums`（`deleted_at IS NULL`）を 1 文で数える）・`albumQuotaFor`・`exceedsFreeQuota`
- `procedures/couple.ts`: `get` が `plan` と `albumQuota`（paid なら null）を足して返す。ゲスト（デモ）にも返す
- `procedures/album.ts`: `create`（cover あり）と `addPhotos` で、free かつ `used + 追加枚数 > 30` なら `PLAN_LIMIT`（1 枚も入れない）。**`LIMIT_REACHED` より先**
- `procedures/me.ts`: `me.delete` の batch に `DELETE FROM couple_plans`（couples より先）

### 画面（`apps/app`）

- `lib/plan.ts`: 文言と計算（`albumQuotaRemaining`・`albumQuotaCountLabel`「27 / 30 枚」・`albumQuotaRemainingLabel`「あと 3 枚」／「上限に達しています」・`albumQuotaHeadingLabel`「30 / 30 枚 - 上限に達しています」・`shouldWarnQuota`（残り 5 枚以下。`QUOTA_WARNING_THRESHOLD = 5`）・`quotaWarningTitle`「残り N 枚です」・`quotaWarningBody`「あと N 枚で上限（無料プラン 30 枚）に達します」・`albumQuotaOverLabel`「あと n 枚まで入れられます」・`planLabel`「無料」「プレミアム」）。数字は全部 `FREE_ALBUM_PHOTO_LIMIT` から
- `components/usage-card.tsx`（絵 05）: 一覧の「写真の使用量」。バー（高さ 10・primary で塗る・used/limit）・「27 / 30 枚」（Poppins 20 bold）・右に「プレミアムで無制限に ›」（→ `/premium`）と「あと 3 枚」
- `components/quota-warning-card.tsx`（絵 01）: 詳細の FAB の上の警告。⚠（`iconWarning` を primary で塗る）「残り N 枚です」「あと N 枚で上限（無料プラン 30 枚）に達します」「プレミアムで無制限に」（secondary ボタン → `/premium`）。primarySubtle の地に primary の枠
- `components/plan-limit-sheet.tsx`（絵 04）: 鍵（`iconLock` を primary で塗り、primarySubtle の丸 72 に）「写真の上限に達しました」「大切な思い出をもっと残すために、プレミアムプランへ。」→ 現在のプラン - 無料 [FREE]「30 枚まで保存可能」→ ↓ → プレミアムプラン [PREMIUM]「✓ 写真枚数 無制限」「プレミアムプランを見る ›」（→ `/premium`）→「× あとで検討する」。価格・トライアル・存在しない機能は書かない
- `app/(tabs)/premium.tsx`（絵 02。`href: null`）: ‹ 戻る（`router.canGoBack()` なら `back()`、無ければ `/album`）・絵（**ピンクはハート `iconPanelWant`、ホワイトは ✦ `iconReleases`。既存の線画を primary で塗る。新しい絵は作らない**）・「プレミアムプラン」「大切な思い出を、もっと自由に。」・「できること」のカード（「✓ 写真枚数 無制限」の 1 行だけ）・「お申し込みは準備中です」の 1 行（ボタンではない）。`_layout.tsx` に登録
- `app/(tabs)/album.tsx`: `couple.get` を読み（viewerKey 付き。ゲストは読まない）、タイムラインのカードの下に使用量のカード（free のときだけ）。作成モーダルの「カバー写真を選択」は残り 0 なら選ばせずモーダルを閉じてシート。`album.create` が `PLAN_LIMIT` を返してもシート
- `app/(tabs)/album-detail.tsx`: `couple.get` を読み（書けるときだけ）、見出しの下に「27 / 30 枚」（free のときだけ）。残り 5 枚以下で FAB の上に固定で警告のカード（選択中は FAB と一緒に隠す。スクロールの下の余白を 120 足す）。残り 0 で FAB → 選ぶ前にシート。残り n で n+1 枚以上選ぶ → 送る前に「あと n 枚まで入れられます」。`addPhotos` が `PLAN_LIMIT` を返してもシート（枠も読み直す）
- `app/(tabs)/profile.tsx`: 「プラン: 無料」＋右に「プレミアムについて ›」（→ `/premium`）。paid は「プラン: プレミアム」だけ（押せない）
- `packages/ui/assets/icon-lock.png`・`icon-warning.png`: 96×96 の線画を B が新規に描き起こした（`artifacts/045/scripts/make-assets.py`。出自は `docs/sample/README.md`「045 で作ったもの」）。人間が渡したホワイトの見本 5 枚は `docs/sample/simpleMode/プレミアム/white/` に格納した

触っていないもの: `releases.ts`（0節 #10）・`album.list` / `album.get` の契約・投稿画面（`compose`）・超過分の削除や非表示・個人単位のプラン。

## テスト（T1〜T9）

| # | テスト | 場所 |
|---|---|---|
| T1 | 30 枚で 1 枚 → `PLAN_LIMIT`、行が増えない。29 枚で 2 枚 → `PLAN_LIMIT`（1 枚も入れない）。29 枚で 1 枚 → 入る。別のアルバムの分も合算。`PLAN_LIMIT` は `LIMIT_REACHED`（500 枚）より先 | `apps/api/test/plan.test.ts` |
| T2 | `album.create`（cover あり）も同じ。cover なしは 30 枚でも作れる。29 枚で cover あり → ちょうど 30 | 同上 |
| T3 | paid（期限なし）→ 31 枚目が入る。期限が未来 → 入る／過去 → free。`plan='premium'`（未知）→ free。`resolvePlan` 単体（行なし・PAID・空・ちょうど今） | 同上 |
| T4 | 削除済みアルバムの写真は数えない（削除すれば枠が戻る）。`post_images` は数えない。別ペアは数えない | 同上 |
| T5 | `couple.get` が free で `{limit:30, used:n}`、paid で `null`。ゲストにも返る。既存の `couple.test.ts` の `toEqual(created)` は `plan`・`albumQuota` を足した形に | `plan.test.ts`・`couple.test.ts` |
| T6 | `me.test.ts` の「couple_id 列を持つ全ての表」「登録の無い全表が 0 件」に `couple_plans` の行を作って走らせた（運営の SQL と同じ文）。arrayContaining にも `couple_plans` | `apps/api/test/me.test.ts` |
| T7 | 詳細: 「26 / 30 枚」「30 / 30 枚 - 上限に達しています」。残り 5 で警告（題・本文・→ `/premium`）、残り 6 で出ない。残り 0 で FAB → シート（題・副題・「30 枚まで保存可能」「写真枚数 無制限」。トライアル・¥・アルバムグループが無い）、写真を選ばない。「プレミアムプランを見る ›」→ `/premium`。残り 2 で 3 枚 → 「あと 2 枚まで入れられます」で送らない。残り 3 で 3 枚 → 送る。サーバの `PLAN_LIMIT` → シート。paid・ゲストに枠の行が無い。一覧: 使用量のカード（27 / 30 枚・あと 3 枚・バー 90%・→ `/premium`）、上限で「上限に達しています」、paid・ゲストに無い、カバー選択が残り 0 でシート（ピッカーを開かない）、`PLAN_LIMIT` → シート | `album-detail-screen.test.tsx`・`album-screen.test.tsx` |
| T7b | `/premium`: 題・副題・「写真枚数 無制限」・「お申し込みは準備中です」。「トライアル」「お試し」「¥」「月額／年額」「アルバムグループ」が無い。申し込みのボタンが無い。ゲストでも開ける。‹ 戻る は `back()`／履歴なしで `/album`。絵はピンクでハート・ホワイトで ✦ | `premium-screen.test.tsx` |
| T8 | 「プラン: 無料」＋「プレミアムについて ›」（→ `/premium`）。paid は「プレミアム」でリンク無し。ゲストには無い | `profile-screen.test.tsx` |
| T9 | `couple_plans` の表が実体にあり、列（PK・NOT NULL・DEFAULT 'manual'・FK）が定義どおり。名前付き CHECK が無い。索引/TRIGGER の一覧は変わらない | `apps/api/test/schema-integrity.test.ts` |

## 検証

- `pnpm test`: api 625・app 473・db 32・ui 16・date 66、全部緑
- `pnpm type-check`: 緑
- `pnpm lint`: 緑

## 停止条件の確認

- 「`couple.get` に足すと既存の画面テストが大量に赤になる」→ 赤は 0 件だった。`couple.get` のモックは `Record<string, unknown>` で作っており、項目を足しても壊れない。ただし詳細・一覧のテストの oRPC のモックに `couple` が無かったので、`couple: { get: coupleGetMock }` を足した（既定は paid = 枠なし。無料枠のテストで free に上書き）。`album-detail-share.test.tsx` は固定の paid
- 「`me.delete` の順序で FK に当たる」→ 当たらなかった（couples の直前に置いた。T6 緑）
- 「30 枚の数え方で `album_photos` に索引が要る」→ 要らない。`album_photos_album_taken_idx` の先頭列 `album_id` で JOIN できる

## 切り替えの SQL がローカルで通った記録

`plan-switch.md` と `plan-switch-local.log`。`0023` を当てたあと、`demo-couple` を paid → free → paid（`success: true`、SELECT で行が変わることを確認）。撮影でも `shot-couple` を同じ文で paid にして、使用量のカード・枠の行・警告が消えることを見た。

## スクリーンショット（`stage1/`。両モード × 端末幅（390×844 @2x）・PC 幅（1280×900））

`scripts/make-session.mjs`（ローカル D1/R2 にペア（ゆう・さき）とアルバム 1 件・写真 N 枚・セッション Cookie。Cookie は artifacts に置いていない）→ `scripts/capture.mjs`。文言は `capture-<state>.json` に記録した。

| 状態 | ファイル | 記録した文言 |
|---|---|---|
| free・26 枚（残り 4） | `{pink,white}-album-list-free26[-pc]`・`-album-detail-free26`・`-premium-free26`・`-profile-free26` | 使用量「26 / 30 枚」「あと 4 枚」・詳細「26 / 30 枚」・警告「残り 4 枚です」・プレミアム「お申し込みは準備中です」（トライアルの文字なし）・マイページ「無料」「プレミアムについて ›」 |
| free・30 枚（残り 0） | 上に加えて `-album-plan-sheet-free30` | 使用量「30 / 30 枚」「上限に達しています」・詳細「30 / 30 枚 - 上限に達しています」・警告「残り 0 枚です」・シート「写真の上限に達しました」「30 枚まで保存可能」「写真枚数 無制限」 |
| paid | `-album-list-paid`・`-album-detail-paid`・`-premium-paid`・`-profile-paid` | 使用量・枠の行・警告は無し（`(無し)`）・マイページ「プレミアム」でリンク無し |

コンソールのエラーは 3 状態とも 404 だけ（各 78 件。写真の署名付き URL が本物の R2 を指し、ローカルの R2 に置いた実体は見えない。041 の撮影と同じ。写真のタイルが空なのはこのため）。それ以外は 0。

## B が決めたこと（A に知らせる）

- 警告のカードは詳細の FAB の**上に固定**（`position: absolute`）で置き、スクロールの下の余白を 120 足した。中身の最後に置く形だと下まで送らないと見えない
- 警告を出す閾値は残り **5 枚以下**（0 を含む。0 のときは「残り 0 枚です」と出て、FAB を押すとシート）
- `/premium` の絵は新しく作らず、ピンクは既存のハートの線画（`iconPanelWant`）、ホワイトは ✦（`iconReleases`）を primary で塗った（3節「凝らない」）
- シートの FREE / PREMIUM のピルは部品の中の小さな `Pill`（`NewBadge` は primary 固定なので使わない）
- `couple.get` の枠は詳細でも一覧でも「書けるとき（ログイン済み・タイムラインでない）だけ」読む。ゲストは couple.get を読まない
- 使用量のカードの右は「プレミアムで無制限に ›」を上、「あと 3 枚」を下に重ねた（ホワイトの見本の形。ピンクでも同じ）
