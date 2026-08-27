# 004 security-auditor 生ログ（1回目）

以下は security-auditor サブエージェントの返答をそのまま転記したもの。

---

### [2026-08-27] 監査対象: 004 ペア作成と招待コード（couple/invite 手続き、招待コード生成、オンボーディング画面、マイグレーション）

| 重大度 | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| High | `apps/api/src/procedures/couple.ts:140,146` / `apps/api/src/index.ts:58` | レート制限のキーが**完全なIPアドレスのみ**。IPv6 は一契約で /64（約1.8×10^19アドレス）が払い出されるのが通常で、送信元アドレスを1ビット変えるだけで「10回/時間」の制限を無制限に回避できる。`invite.accept` は認証必須（couple.ts:138）で `context.user.id` が確定しているのに、制限キーに使っていない。要件4節が必須と定める3点のうちレート制限が実質的に成立しない。総当たり空間は 31^6 ≒ 8.9億で、上限が外れれば24時間の有効期間内に到達しうる規模。根拠: 悪用容易（アドレス変更のみ）×影響最大（他ペアの写真・本文への侵入） | 制限キーを多層化する。(1) `user.id` 単位（例: 10回/時間）を主キーとして追加、(2) IP は IPv6 を /64 に正規化してから記録、(3) コード単位・グローバルの上限も併用。Cloudflare の Rate Limiting binding か Durable Object に寄せると自前カウンタの弱点をまとめて解消できる |
| Medium | `apps/api/src/procedures/couple.ts:144-157` | レート制限が check-then-insert の **TOCTOU**。`SELECT COUNT(*)`（146行）で読んでから `INSERT INTO invite_failures`（155行）するまでが原子的でない。並行に N 本のリクエストを投げると全てが閾値未満を観測して通過するため、1時間あたりの試行回数を並列度ぶん押し上げられる。`docs/architecture.md` 4節が禁じている「読んでから判断して書く」形そのもの | 判定と記録を単一SQLにする（例: `INSERT INTO invite_failures (...) SELECT ?1, ?2 WHERE (SELECT COUNT(*) FROM invite_failures WHERE ip_address = ?1 AND created_at > ?3) < 10` の更新件数で判定）か、外部のレート制限機構に委譲する |
| Medium | `apps/app/app/(onboarding)/create.tsx:24-27` / `apps/app/app/(onboarding)/invite.tsx:10` | 招待コードを Expo Router の `params` で `/invite` へ渡している。Expo Router は動的セグメントでない値をクエリ文字列に載せるため、**Web ビルドでブラウザのURLに `?code=XXXXXX` として露出**する。`docs/security-requirements.md` 1節は招待コードを「高」区分とし「URLクエリに載せない」と明記している。ブラウザ履歴・共有端末・外部リンク経由の Referer から漏れる | ナビゲーションパラメータで運ばない。`invite.issue` の結果を TanStack Query のキャッシュか React Context に置き、`/invite` 画面側で読む。どうしても遷移で渡すなら Web ではクエリに出ない経路（state 経由）にする |
| Medium | `apps/api/src/lib/invite-code.ts:3,6,12` | 文字集合 `"23456789ABCDEFGHJKMNPQRSTUVWXYZ"` は**31文字**だが、6行目のコメントは「文字集合が32文字（256 % 32 === 0）なのでバイト値を割った余りに偏りが出ない」と述べている。事実は `256 % 31 = 8` で剰余バイアスが存在し、`2`〜`9` の8文字は 9/256、残り23文字は 8/256 と 12.5% の偏りが出る。最も出やすいコードの出現確率は一様分布の約1.68倍。要件4節の「暗号論的乱数」の前提が部分的に崩れており、コメントが誤っているため将来も修正されない。`apps/api/test/invite.test.ts:46` の正規表現も同じ31文字集合なので、この不整合を検出できない | 拒否サンプリングにする（`byte >= 248` を捨てて引き直す）か、文字集合を32文字に揃える。どちらを選んでもコメントを実際の文字数に合わせて書き直す |
| Low | `apps/api/src/procedures/couple.ts:189-199` | エラーコードが**コード有効性のオラクル**になっている。既にペアに所属しているユーザーが総当たりした場合、コードが有効（未使用・期限内）なときだけ `couple_members.user_id` の UNIQUE 違反で `FORBIDDEN`（191行）、無効なら `NOT_FOUND`（199行）が返るため、当たり判定を外部から識別できる。両経路とも失敗を記録するので試行回数の削減にはならず実害は限定的だが、有効コードの存在確認に使える | `invite.accept` の失敗は理由を問わず単一のエラーコードに統一する。「既にペアに所属している」は `couple.get` で事前に判る情報なので、UX上の損失はない |
| Low | `apps/api/src/context.ts:6` / `apps/api/src/index.ts:58` / `apps/api/src/procedures/couple.ts:140` | `cf-connecting-ip` 欠落時に `?? "unknown"` で**全リクエストが単一バケットに合流**する。Cloudflare 経由なら同ヘッダはエッジで上書き付与されるためなりすまし・fail-open にはならず（`x-forwarded-for` を使っていない選択は正しい）、厳しい側に倒れる挙動だが、ヘッダが無い環境では無関係な利用者1人の10回失敗で全員が `RATE_LIMITED` になる相互DoSが成立する | ヘッダ欠落時は共有バケットに丸めず、`context.user.id` をキーにフォールバックする（High指摘の対応を入れれば自然に解消する） |
| Low | `packages/contract/src/invite.ts:7-10` | `inviteCodeSchema` が `.length(6)` のみで文字集合を検証していない。プレースホルダ束縛（couple.ts:179,184）のため SQLi にはならないが、明らかに無効な入力がDB書き込み（`invite_failures`）まで到達する。なお `.toUpperCase()` はロケール非依存で、`toLocaleUpperCase` のようなトルコ語 I 問題は無い | `z.string().regex(/^[2-9A-HJ-NP-Z]{6}$/)` を transform 後に課し、無効な文字集合を手続きの入口で弾く |
| Low | `packages/contract/src/couple.ts:5-10` | `anniversaryDateSchema` は形式と実在日（V8 は `2024-02-31T00:00:00Z` を Invalid Date にするため refine は機能する）を見ているが、**年の範囲と未来日の制限が無い**。`9999-12-31` や `0001-01-01` が通り、「付き合って○日目」（architecture.md 4節）が負数や非現実的な値になる | 下限（例: `1900-01-01`）と「今日（JST）以前」の上限を追加する |
| Low | `apps/api/src/procedures/couple.ts:134,209` | 内部エラーを素の `Error` で投げている。oRPC は未定義エラーを `INTERNAL_SERVER_ERROR` / `"Internal server error"` に丸めるため（`node_modules/.pnpm/@orpc+client@1.15.0/.../shared/client.CZlviB0y.mjs:167-172` の `toORPCError` を確認。`cause` はレスポンスに載らない）、メッセージ・スタックトレースの外部漏洩は**発生しない**。ただし要件8節の「サーバ内部のエラーに一意なIDを振り、クライアントにはIDのみ返す」は未実装 | 相関IDを付与する共通のエラーハンドラを後続タスクで入れる。現状のままでも情報漏洩は無い |
| Low | `apps/api/src/procedures/couple.ts:101-135` | `invite.issue` に発行レート制限が無く、**既に2人揃っているペアでも有効なコードを発行できる**。決して使えないコードが24時間有効なまま残り、有効コードの母集団を無駄に膨らませる（上のオラクル指摘と組み合わさる）。また `invites` 行に掃除処理が無く（`invite_failures` は144行で掃除している）単調増加する | 発行文の WHERE に「自ペアに空きスロットがある」条件を埋め込み、更新件数0で拒否する。期限切れ `invites` の定期削除も入れる |

### 監査済み・指摘なしの項目（確認した根拠）

- **水平権限昇格の経路なし**: `packages/contract/src/couple.ts:20,36` と `invite.ts:22` の input を全て確認し、`coupleId` を引数に取る手続きは**ゼロ**。`couple.get`（couple.ts:74）、`couple.update`（couple.ts:91）、`invite.issue`（couple.ts:105）はいずれも `context.user.id` からペアを解決している。要件3節に適合
- **SELECT→UPDATE の2段階なし**: `couple.update`（couple.ts:87-95）は所有者確認を `WHERE id IN (SELECT couple_id FROM couple_members WHERE user_id = ?2)` としてUPDATE文に埋め込み、`RETURNING` の有無で判定している。要件3節の指示どおり
- **`invite.accept` の原子性**: `batch()`（couple.ts:165-185）は制約違反で全文ロールバックするため、期限切れ・満員・所属済みのいずれの失敗でも `used_at` だけが刻まれる状態にならない（`apps/api/test/invite.test.ts:134-154` が証明）。同一コードの並行受理は `UNIQUE (couple_id, slot)`（migrations/0002_couple.sql:13）と `couple_members_user_id_unique`（同12行）が最終防壁になり、3人目が入る経路は無い。他人のコードを消費して妨害する DoS も成立しない
- **有効期限と同時1件**: 期限は `expires_at > ?` を文1・文2の両方に課している（couple.ts:176,182）ため、batch が片方だけ成立する余地が無い。同時1件は発行時の一括無効化（couple.ts:117）で担保され、テスト `invite.test.ts:63-73` が証明
- **ログ出力なし**: リポジトリ全体を `console.(log|warn|error|info|debug)` で検索し、自前コードにヒット0（`artifacts/003/security-audit-raw.md` の記述のみ）。招待コード・メールアドレス・トークンがログに出る経路は無い
- **SQLインジェクションなし**: 対象ファイル内の全SQLが `?1` 形式のプレースホルダ束縛。文字列連結による組み立ては1箇所も無い
- **秘密情報のハードコードなし**: `.gitignore:14-20` で `.dev.vars` 系を除外済み。`apps/api/wrangler.toml` は D1/R2 バインディングのみで `[vars]` を持たず、003監査の指摘に沿った状態が維持されている
- **未認証書き込みの拒否**: `couple.create`（38行）、`couple.update`（84行）、`invite.issue`（102行）、`invite.accept`（138行）が全て冒頭で `if (!context.user) throw errors.FORBIDDEN()`。`invite.accept` はレート制限用のDB書き込み（144行）より前に認証チェックがあり、未認証者にDB書き込みをさせない
- **`migrations/0000_init.sql:5` の `SELECT 1;`**: 副作用が無く、権限・データに影響しない。指摘なし
- **XSS**: React Native / RN Web のテキスト描画のみで、対象4画面に `dangerouslySetInnerHTML` は無い

### 補足（今回の範囲外・次回に持ち越す確認事項）

- **デモ経路（T4/T5）と R2 画像（T3）は未実装のため未監査**。`couple.get` は未認証で `FORBIDDEN` を返す実装で、architecture.md 5節が定めるデモ readonly モードはまだ入っていない。タスク005以降で再監査が必要
- **CSP / セキュリティヘッダが未設定**（`apps/api/src/index.ts` にヘッダ付与のミドルウェア無し）。静的アセット配信自体がまだ `wrangler.toml` に無いため、配信を繋ぐタスクで対応すべき
- **依存関係の既知脆弱性は未検証**。`pnpm audit` / gitleaks の出力が渡されていないため、今回はコードのみを対象にした。要件9節 T6/T7 の確認は静的ツールの出力とあわせて実施してほしい
- **テストの穴**: 45件にレート制限の並行実行ケースと `ip: null` のケースが無く、上記 High / Medium の2件をテストで検出できない状態。`couple.update` の未認証 `FORBIDDEN` ケースも欠けている

# 004 security-auditor 生ログ（2回目・1回目の指摘への対応後の再監査）

以下は security-auditor サブエージェントの返答をそのまま転記したもの。

---

## 監査結果

`docs/security-requirements.md` 4節（招待コード）・6節（入力検証）・8節（ログとエラー）を基準に、指定された8ファイルを実際に読んで確認しました。以下、そのまま転記できる形で報告します。

---

### [2026-08-27] 004 再監査: ペア作成・招待コード（前回指摘の修正確認）

対象: `apps/api/src/procedures/couple.ts`, `apps/api/src/lib/invite-code.ts`, `apps/api/src/index.ts`, `apps/api/src/context.ts`, `packages/contract/src/{invite,couple}.ts`, `packages/db/src/schema/couple.ts`, `packages/db/migrations/0002_couple.sql`, `apps/app/app/(onboarding)/{create,invite,join}.tsx`, `apps/app/app/_layout.tsx`, `apps/api/test/{invite,couple}.test.ts`

#### 1. 前回指摘の解消状況（8件すべて該当行を確認）

| 前回重大度 | 箇所 | 判定 | 確認内容 |
|---|---|---|---|
| High | `apps/api/src/procedures/couple.ts:151-166` | **解消** | 判定条件が `(user_id = ?1 OR ip_address = ?2) AND created_at > ?4` になっており、IPを変えても `user_id` 側で捕捉される。`packages/db/src/schema/couple.ts:67-69` と `packages/db/migrations/0002_couple.sql:23,29` で `user_id` 列（NOT NULL・FK）と `(user_id, created_at)` インデックスの実在も確認。`invite.test.ts:222-235` が毎回別IPで10回失敗→11回目 RATE_LIMITED を証明している |
| Medium | `apps/api/src/procedures/couple.ts:152-163` | **解消** | `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?5 RETURNING id` の**単一文**。SQLite では1文が原子的に評価されるため、check→insert の窓が構造的に消えている。予約失敗時は `RETURNING` が0行→`first()` が `null`（`couple.ts:168`）で `RATE_LIMITED`。`invite.test.ts:255-271` の並行20本テストが NOT_FOUND 10 / RATE_LIMITED 10 を固定値で検証しており、境界がぶれないことも担保されている |
| Medium | `apps/app/app/(onboarding)/create.tsx:21-25` | **解消（ただし後述の新規指摘あり）** | `router.push("/invite")` にパラメータが無く、コードを一切保持していない。`invite.tsx:17-21` が自前で `invite.issue` を呼ぶ。Webでもクエリ文字列にコードは出ない |
| Medium | `apps/api/src/lib/invite-code.ts:3` | **解消** | `"23456789ABCDEFGHJKLMNPQRSTUVWXYZ"` を1文字ずつ数えて **32文字**（数字8＋英字24）を確認。`L` が入っている。`256 % 32 === 0` なので `byte % 32` に剰余バイアスは無い。`crypto.getRandomValues` 使用（`invite-code.ts:9`）、`Math.random()` の使用箇所は無し |
| Low | `apps/api/src/procedures/couple.ts:225` / `:231` | **解消** | 制約違反経路（満員・既所属）も0件経路（存在しない・期限切れ・使用済み）も同じ `errors.NOT_FOUND()`。さらに `db.batch` は例外時に全文ロールバックされるため、満員のペア宛コードで `used_at` だけが刻まれる副作用差分も生じない＝**副作用によるオラクルも無い**。`packages/contract/src/invite.ts:28-36` の宣言も `FORBIDDEN`（未認証のみ）/`NOT_FOUND`/`RATE_LIMITED` の3つに整理されている |
| Low | `apps/api/src/procedures/couple.ts:157-163` | **解消（残渣あり、下表 R-2）** | IP欠落時は `WHERE user_id = ?1` のみで判定し、他利用者を巻き込まない。`invite.test.ts:237-253` が別ユーザーの非巻き込みを検証 |
| Low | `packages/contract/src/invite.ts:8-14` | **解消** | `.length(6)` → `toUpperCase()` → `/^[2-9A-HJ-NP-Z]{6}$/`。この正規表現が表す集合を展開すると 2-9(8) + A-H(8) + J-N(5) + P-Z(11) = 32 文字で、生成側の文字集合と**過不足なく一致**。入力検証は handler より前に走るため、文字集合外のコードはレート制限枠を消費しない（`invite.test.ts:114-119`） |
| Low | `packages/contract/src/couple.ts:13-24` | **解消** | 形式・実在日（`new Date("2020-02-31T00:00:00Z")` は NaN になる）・下限1900-01-01・上限 `todayInJst()` の4段。`todayInJst()` は呼び出しごとに評価されるため日付跨ぎで固まらない。出力側 `coupleSchema` は `z.string()` のままなので既存レコードの返却が壊れない点も確認済み |

#### 2. 新規指摘（今回の修正で生じたもの・再確認で見つかったもの）

| 重大度 | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| Medium | `apps/app/app/(onboarding)/invite.tsx:17-21` | **画面遷移（GET相当）だけで状態変更が起きる。**マウント時に無条件で `invite.issue` を撃つため、`/invite` に到達するたびに新コードが発行され、`couple.ts:117` の `UPDATE invites SET used_at ... WHERE used_at IS NULL` で**既に相手に渡した未使用コードが黙って無効化される**。`_layout.tsx:34-36` の guard は `needsOnboarding`（＝相手がまだ参加していない状態）で真なので、有効なコードが出回っている期間がちょうど攻撃可能窓になる。SameSite=Lax はトップレベルGET遷移にCookieを載せるため、攻撃者が被害者に `https://<app>/invite` へのリンクを踏ませるだけでペアリングを反復的に妨害できる（コード自体はSOPで読めないので、影響は開示ではなくDoS）。Web版の単なるリロードでも同じ事故が起きる。悪用容易性は高く影響は限定的（再共有で復旧可能）なため Medium | 発行を明示的なユーザー操作（「コードを発行する」ボタン）に紐づける。あるいは `invite.issue` を「有効な未使用コードがあれば再利用し、無ければ発行する」冪等な手続きに変え、無効化は明示的な再発行操作のときだけ行う。`security-requirements.md` 7節「状態変更を GET で行わない」の趣旨に合わせる |
| Low | `apps/api/src/procedures/couple.ts:101-135`（`invite.issue` 全体） | `invite.issue` に**レート制限が一切無い**。上記の自動発行と組み合わさると、1回の遷移ごとに `invites` へ1行増え続ける（`used_at` を刻むだけで削除しないため単調増加）。総当たり耐性そのものは損なわないが、行数の無制限増加とペアリング妨害の増幅要因になる | `invite.accept` と同様のスロット予約方式で `invite.issue` にも上限（例: 10回/時間・ペア単位）を設ける。あわせて `used_at` 済みかつ期限切れの `invites` 行を定期削除する |
| Low | `apps/api/src/procedures/couple.ts:166` | IP欠落時も `ip_address` 列には文字列 `"unknown"` が実値として書き込まれる（`ip ?? "unknown"`）。判定は `user_id` 単独に分岐しているので前回指摘の相互DoSは解消しているが、列には共有トークンが残り続けるため、将来 `ip_address` を単独で集計・判定するコードを足した瞬間に共有バケット問題が復活する。また `cf-connecting-ip` に文字列 `unknown` が入る配信形態（CF以外の前段を挟む等）では即座に衝突する | `ip_address` を nullable にして IP 欠落時は NULL を入れる。列を NOT NULL のまま維持するなら、`"unknown"` ではなく実IPと構文的に衝突しないセンチネル（例: `none:<user_id>`）にする |
| Low | `apps/api/src/procedures/couple.ts:155` | IP側の条件が実アドレス完全一致・上限10/時間の**OR**であるため、CGNAT配下（日本のモバイル回線では常態）で無関係の第三者が同一IPの枠を使い切ると、正当な利用者が `RATE_LIMITED` で参加できなくなる。前回から継続の構造的問題であり今回の修正による悪化ではないが、`user_id` キーが入った今は「IP側の上限を緩める」余地ができている | user側とIP側で閾値を分離する（例: user_id 10回/時間、ip_address 50回/時間）。IPv6は完全一致ではなく /64 プレフィクスをキーにすると、ローテーション耐性を保ちつつ巻き込みを減らせる |
| Low | `apps/api/src/procedures/couple.ts:178` ＋ `packages/db/migrations/0002_couple.sql:29-30` | 毎回の `invite.accept` 冒頭で `DELETE FROM invite_failures WHERE created_at <= ?1` を実行しているが、`created_at` 単独のインデックスが無く（既存は `(user_id, created_at)` と `(ip_address, created_at)` の複合先頭列違い）全表走査になる。テーブルはレート制限自体で有界なので実害は小さいが、D1 の行読み取り課金と遅延の増幅要因 | `created_at` 単独インデックスを追加するか、掃除を毎リクエストではなく確率的（例: 1/50）またはCronに移す |
| Info | `apps/api/src/procedures/couple.ts:130` / `:226` / `:244` の `throw error` / `throw new Error(...)` | oRPC の挙動を実装で確認した。`@orpc/server` の `StandardHandler.handle` は非 `ORPCError` を `toORPCError()` に通し、`@orpc/client` の実装（`client.CZlviB0y.mjs:167-172`）が `message: "Internal server error"` で包み直す。`ORPCError.toJSON()`（同 133-141行）は `defined/code/status/message/data` のみを直列化し `cause` を含めない。**D1のエラーメッセージやSQL断片がクライアントへ漏れることは無い**ことを確認 | 対応不要。ただし `security-requirements.md` 8節の「内部エラーに一意なIDを振る」は未実装のまま（003監査Lowの積み残し）。`app.onError` でのID採番は継続課題 |
| Info | `apps/api/src/procedures/couple.ts` 全体 ／ `packages/contract/src/{couple,invite}.ts` | 水平権限昇格（T1）の再確認。**手続きの入力に `coupleId` は存在しない**。`couple.get`/`couple.update` は `couple_members.user_id = ctx.user.id` からペアを導出し、`update` は所有者確認とUPDATEを1文に統合（`couple.ts:87-95`）。`invite.accept` の参加も `INSERT ... SELECT ... FROM invites WHERE code = ?` の1文で、SELECT後にUPDATEする2段階になっていない。指摘なし | 対応不要 |
| Info | `apps/api/src/procedures/couple.ts` 全体／リポジトリ全体 grep | 招待コード・トークン・本文の `console.*` 出力は皆無（ヒットは `worker-configuration.d.ts` の型定義コメントのみ）。ハードコードされた鍵・パスワードも無し | 対応不要 |

#### 3. 総評

前回の8件はすべて該当行で解消を確認しました。特に TOCTOU 対策は「1文に統合」という構造的な解法で、`invite.test.ts:255-271` が期待値を範囲ではなく固定値（10/10）で検証しているため、将来の退行も検知できます。エラーの一本化も、返却コードだけでなく `db.batch` のロールバックによって副作用の差分まで消えている点まで確認済みです。

一方で、招待コードをURLから外す修正の副作用として、**画面遷移だけで既存コードが無効化される経路**（Medium）が新たに生まれています。これは前回指摘の解決策として選ばれた「マウント時に自分で発行する」方式そのものに起因するため、発行契機の設計を見直すことを推奨します。

なお、デモ経路・R2画像・CSP・依存関係の既知脆弱性は、ご指示のとおり今回のスコープ外としています。
