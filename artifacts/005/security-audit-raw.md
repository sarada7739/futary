# 005 security-auditor 生ログ

## 1回目監査

## 2026-08-28 監査対象: 005 認可ミドルウェア（`resolveCoupleContext` / `readProcedure` / `writeProcedure` / 載せ替え済み手続き）

**High 以上の指摘: ゼロ**（`docs/tasks/005-authorization-middleware.md` 完了条件を満たす）。Medium 2件、Low 2件。

| 重大度 | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| Medium | `apps/api/src/middleware/auth-context.ts:31-32` / `apps/api/src/procedures/couple.ts:68-74` | **未認証経路で `is_demo` を一切検証していない。** `resolveCoupleContext` は `context.demoCoupleId` が truthy かどうかだけを見て `coupleId` に載せ、`couple.get` は `WHERE id = ?1` のみで絞る。`security-requirements.md:133`（T4）と `decisions.md:138`（ADR-010）は「デモペアは `is_demo` で識別し、未認証時は他を一切参照しない」と定めており、この識別子が実装に存在しない。防御線は「env に入っている UUID が正しいこと」だけ。014 で実在ペアの id を貼り間違える／検証で一時的に実ペア id を入れて戻し忘れる、が成立した瞬間、未認証の全インターネットに実在ペアの読み取り権限が渡る<br>**根拠**: 悪用には設定ミスが要るため容易ではないが、成立時の影響は「守る対象そのものの全公開」で最大級。005 時点では `wrangler.toml:27` が `""` のため現に露出はしていない。**014 でこのまま `DEMO_COUPLE_ID` を設定すると High 相当に昇格する** | `resolveCoupleContext` の未認証分岐で `SELECT id FROM couples WHERE id = ?1 AND is_demo = 1` を実行し、0件なら `FORBIDDEN`。DB1往復が増えるが未認証経路のみで、`ctx.coupleId` が「実在するデモペア」であることが型ではなくデータで保証される。014 を待たず 005 で入れるべき（005 が唯一この分岐を持つ層） |
| Medium | `apps/api/src/procedures/couple.ts:39-40, 168-169` / `apps/api/src/router.ts:6-16` | **認可が2系統に割れている。** `couple.create`・`invite.accept` は基底を経由せず、ハンドラ内の `if (!context.user) throw errors.FORBIDDEN()` に依存。`health.get`・`me.get` も基底なし。005 の目的は「手続きごとに認可を書かなくてよい状態」（タスク3-6行目）だが、書き続ける必要が残っている。今日時点では両者が `context.user.id` を dereference するため TS が漏れを捕まえるが、`ctx.coupleId` だけ使い `context.user` に触れない書き込み手続き（006 の `post.create` がまさにこの形になる）で `.use(writeProcedure)` を書き忘れると、**型エラーにならず未認証で通る**<br>**根拠**: 現時点で悪用不可。ただし「手続きごとに認可を書くと必ずどこかで書き忘れる」（`security-requirements.md:26`）という、この設計が防ごうとしたリスクそのものが残存している | `base.ts` に第3の基底 `authedProcedure`（`context.user` が null なら FORBIDDEN、couple 解決はしない）を追加し、`couple.create` / `invite.accept` をその上に載せる。あわせて `router` を再帰走査し、全 leaf 手続きが3基底のいずれかを経由していることを検査する回帰テストを置く（未経由なら失敗させ、`health`/`me` は明示的な許可リストに入れる） |
| Low | `apps/api/test/authorization.test.ts:91-111` | 項目2「未認証アクセスで書き込み系の手続きが**全て** FORBIDDEN」の検証が、`couple.update` と `invite.issue` の2件をハードコードした列挙にとどまる。`couple.create` / `invite.accept` の同等テストは `couple.test.ts:54-56` / `invite.test.ts:110-112` に分散しており、「全て」であることをこのファイル単独では確認できない。手続きが増えるたび人手で追記する構造で、追記漏れは静かに通る | 上記 Medium の走査テストと統合し、`router` から write 系手続きを自動列挙して未認証コンテキストで全件 FORBIDDEN を確認する形にする。列挙の網羅性を人手に依存させない |
| Low | `apps/api/src/procedures/couple.ts:78, 93` | `throw new Error("couple_id に対応するペアが見つかりません")`。**外部漏洩はない** — `@orpc/server` は非 `ORPCError` を `toORPCError`（`node_modules/.pnpm/@orpc+client@1.15.0/node_modules/@orpc/client/dist/shared/client.CZlviB0y.mjs:167-172`）で `INTERNAL_SERVER_ERROR` / `"Internal server error"` に包み直すため、メッセージもスタックもクライアントに出ない（要件8節は充足）。問題は運用面で、この分岐が起きる唯一の条件が「`DEMO_COUPLE_ID` が存在しない couple を指している」= 014 の設定ミスであり、外部からは 500 としか見えず原因追跡が困難 | 指摘1（`is_demo` チェック）を入れれば `FORBIDDEN` に収束してこの経路自体が消える。同時対応でよい |

### 確認して問題なかった点（Info）

- **手続きの引数に `coupleId` が現れない**: `packages/contract/src/couple.ts` `invite.ts` を全読、リポジトリ全体 grep でも入力スキーマ側の出現ゼロ。`security-requirements.md:29` を満たす
- **2段階更新なし**: `couple.update`（`apps/api/src/procedures/couple.ts:82-95`）は `UPDATE couples SET ... WHERE id = ?2 RETURNING` の1文。`security-requirements.md:31-32` を満たす
- **fail-closed の経路が実際に閉じている**: `apps/api/src/index.ts:63` の `c.env.DEMO_COUPLE_ID ? c.env.DEMO_COUPLE_ID : null` で空文字を null へ正規化し、`auth-context.ts:31` の `!context.demoCoupleId` で拒否。`wrangler.toml:27` は `""`。`undefined` が `coupleId` に流れ込む経路は存在しない
- **`CoupleContext` のユニオン型設計が有効に効いている**: `auth-context.ts:8-10` で `readonly` 側の `userId` を `null` に固定したため、`writeProcedure`（`base.ts:37`）が readonly を弾いた後は `userId: string` に絞られる。`invite.issue`（`couple.ts:98,114`）が `created_by` に非 null を渡せることが型で保証されている。認可の状態を型に持たせた点は良い
- **context の上書き方向が正しい**: `mergeCurrentContext`（`@orpc/server/dist/shared/server.DEBcqOjg.mjs:65-67`）は `{...context, ...other}` で、ミドルウェアの返す `coupleId` が必ず勝つ。クライアント入力が context に混入する経路はない
- **`couple_id` 解決が一意**: `packages/db/migrations/0002_couple.sql:12` の `couple_members_user_id_unique` により、`auth-context.ts:35-38` の `.first()` は常に一意。「複数ペア所属で解決先がぶれる」経路なし
- **contract が `FORBIDDEN` を宣言し忘れても fail-closed**: `createORPCErrorConstructorMap`（`server.DEBcqOjg.mjs:69-90`）は未宣言コードでも `defined: false` の `ORPCError` を生成し、`FORBIDDEN` は共通定義の 403 にフォールバックする。基底を載せた手続きが誤って拒否を素通りする形にはならない
- **招待コード（要件4節の3点）は維持されている**: `crypto.getRandomValues` / 32文字集合で剰余偏りなし（`apps/api/src/lib/invite-code.ts:7-15`）、TTL 24時間（`couple.ts:5`）、再発行時に既存未使用コードを同一 batch で無効化（`couple.ts:108-109`）、`user_id` 10回・`ip_address` 50回の二本立てレート制限（`couple.ts:10-12, 146-163`）。005 の変更で退行していない
- **ログ出力ゼロ**: `apps/api/src` 全体に `console.` / logger のマッチなし。要件8節を満たす
- **`.dev.vars`**: `.gitignore:15-16` で除外済み。`apps/api/.dev.vars.example` は空欄のみで秘密値の混入なし

### 5項目との突き合わせ（`docs/security-requirements.md` 3節）

| # | 状態 | 根拠 |
|---|---|---|
| 1 | 充足 | `authorization.test.ts:60-89`。入力に `coupleId` が無いことに立脚した検証で、設計と整合している |
| 2 | 充足（テスト構造に Low 指摘あり） | `authorization.test.ts:91-111` + `couple.test.ts:54-56` + `invite.test.ts:110-112` で4手続き全てを網羅 |
| 3 | **部分的** | `authorization.test.ts:113-124` は「デモペアが返ること」を確認するが、`is_demo` による識別が実装にないため「デモペアのデータ**のみ**」は env 値の正しさに依存（Medium 指摘1） |
| 4 | 充足 | `authorization.test.ts:126-147` で3手続き |
| 5 | 充足 | `authorization.test.ts:149-161` で null と空文字の両方を検証。拒否側を検証しており成功パスだけになっていない |

### 静的ツール

`pnpm audit` / gitleaks の出力は本監査に渡されていない。`docs/security-requirements.md:147` は「静的ツールを先に実行し、その出力を監査エージェントに読ませる」としているため、**次回はその出力を添えて再実行することを推奨**する。依存関係（T7）については本報告では判定していない。

---

## 2回目監査（1回目の修正確認）

## 再監査結果: Medium 2件とも解消。新たな問題なし

**指摘1（is_demo未検証）— 解消。** `apps/api/src/middleware/auth-context.ts:38-43` で `SELECT id FROM couples WHERE id = ?1 AND is_demo = 1` を実行し、0件なら `FORBIDDEN`。意図どおりです。加えて `coupleId` に env の値ではなく **DBが返した `demo.id` を載せている**（43行目）点が良い。信頼の起点が env からDBの実データに移り、T4（`security-requirements.md:133`）の「`is_demo` で識別する」が実装として存在するようになりました。014 で id を貼り間違えても、未認証アクセスは通らず FORBIDDEN で止まります。副次的に、Low指摘4（存在しない couple を指したときの 500）も同時に消えています。

**指摘2（認可の2系統）— 解消。** `base.ts:20-33` の `authedProcedure` は OutContext を `{ user: NonNullable<...> }` にしており、`couple.ts:58` と `couple.ts:174` が手書きチェックなしで `context.user.id` を参照できています。`next({ context: { user: context.user } })` は `mergeCurrentContext` の `{...context, ...other}` で `db`/`ip`/`demoCoupleId` を保持しつつ `user` だけを絞り込んだ値で上書きするため、正しい積み直しです。couple 配下5手続きすべてが3基底のいずれかを経由する状態を確認しました。

**新たな穴の確認**: 未認証時のDB1往復増は `resolveCoupleContext` の未認証分岐のみで、認証済み経路は不変。`authedProcedure` は `couple_id` を解決しないため、この上に載る手続きが `ctx.coupleId` を参照すると型エラーになる — 誤用が型で塞がれています。

**残件**: Low（テスト網羅が人手依存）は認識のとおり残存。006 で書き込み手続きが増えた時点で走査テスト化を再検討してください。
