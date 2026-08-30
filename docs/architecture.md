# アーキテクチャ: futary

## 1. 技術構成

| 層 | 採用技術 | 補足 |
|---|---|---|
| アプリUI | Expo / Expo Router / React Native Web / TypeScript | Web とネイティブで単一コードベース |
| 状態・通信 | TanStack Query | ポーリングで更新を賄う（ADR-008） |
| API | Cloudflare Workers / Hono / oRPC / Zod | oRPC から OpenAPI を生成（ADR-003） |
| 認証 | Better Auth（Google OAuth）/ Expo SecureStore | メール送信基盤を持たない（ADR-004） |
| DB | Cloudflare D1 / Drizzle ORM | SQLite |
| 画像 | Cloudflare R2（非公開バケット・署名付きURL） | クライアント側で圧縮（ADR-007） |
| 配信 | Cloudflare Workers Static Assets | LP とアプリを同一 Worker から配信 |
| ランディング | 素の HTML / CSS | RN Web を使わない（ADR-002） |
| 開発 | pnpm workspace / GitHub Actions | |
| 将来のアプリ配布 | EAS Build | Web公開後 |

## 2. ディレクトリ構成

```
futary/
  apps/
    app/                 # Expo Router + React Native Web（アプリ本体）
    api/                 # Cloudflare Workers（Hono + oRPC）。静的アセットの配信も担う
    landing/             # ランディングページ（HTML / CSS / 画像）
  packages/
    contract/            # oRPC 手続き定義 + Zod スキーマ（型の単一の源）
    date/                # 日付計算（JST 前提。サーバとクライアントで共有）
    db/                  # Drizzle スキーマとマイグレーション
    ui/                  # デザイントークンと共通コンポーネント
  docs/
  artifacts/
```

`packages/contract` がサーバとクライアントの唯一の契約。
サーバの実装を変えると、クライアントの型が壊れて気づける状態を保つ。

## 3. ルーティングと配信

Worker は1つ。ドメインも1つ。ビルド時に `apps/landing` の出力と
`apps/app` の Web エクスポート結果を1つの公開ディレクトリに合成する。

| パス | 中身 |
|---|---|
| `/` | ランディングページ（静的） |
| `/app/*` | アプリ本体（Expo Web エクスポート・SPA フォールバック） |
| `/api/*` | Hono + oRPC |
| `/api/openapi.json` | oRPC が生成する API 仕様 |

## 4. データモデル

タイムスタンプは Unix 秒（INTEGER）。日付は `YYYY-MM-DD` の文字列。
タイムゾーンは **Asia/Tokyo 固定**。サーバ側で JST の「今日」を算出する。

### Better Auth 管理テーブル
`user` / `session` / `account` / `verification`。スキーマは Better Auth の定義に従う。

### アプリケーションテーブル

```
couples
  id                TEXT    PK
  anniversary_date  TEXT    NOT NULL          -- 付き合った日
  is_demo           INTEGER NOT NULL DEFAULT 0
  created_at        INTEGER NOT NULL

couple_members
  couple_id  TEXT    NOT NULL -> couples.id
  user_id    TEXT    NOT NULL -> user.id   UNIQUE   -- 1人1ペアまで
  slot       INTEGER NOT NULL CHECK (slot IN (1, 2))  -- 1ペア2人までをDBで担保
  joined_at  INTEGER NOT NULL
  PRIMARY KEY (couple_id, user_id)
  UNIQUE (couple_id, slot)

invites
  code        TEXT    PK                    -- 6桁。紛らわしい文字を除いた英数
  couple_id   TEXT    NOT NULL
  created_by  TEXT    NOT NULL
  expires_at  INTEGER NOT NULL              -- 発行から24時間
  used_at     INTEGER                       -- 使用済みなら非NULL

posts
  id           TEXT    PK
  couple_id    TEXT    NOT NULL
  author_id    TEXT    NOT NULL
  body         TEXT    NOT NULL DEFAULT ''
  image_key    TEXT    UNIQUE                -- R2 オブジェクトキー。サーバが組み立てる
                                            -- UNIQUE: 同じ画像を複数の投稿から参照させない
  image_width  INTEGER
  image_height INTEGER
  created_at   INTEGER NOT NULL
  deleted_at   INTEGER                       -- 論理削除
  INDEX (couple_id, created_at DESC)

reactions
  post_id     TEXT    NOT NULL
  user_id     TEXT    NOT NULL
  kind        TEXT    NOT NULL               -- 'heart' 等
  created_at  INTEGER NOT NULL
  PRIMARY KEY (post_id, user_id, kind)

events
  id             TEXT    PK
  couple_id      TEXT    NOT NULL
  date           TEXT    NOT NULL            -- YYYY-MM-DD
  title          TEXT    NOT NULL
  kind           TEXT    NOT NULL            -- 'anniversary' | 'plan' | 'meetup'
  repeat_yearly  INTEGER NOT NULL DEFAULT 0  -- kind='anniversary' のときだけ 1
                                            -- 入力スキーマで拒否する（5節）
  time           TEXT                        -- HH:MM（JSTの壁時計）。任意。
                                            -- anniversary には設定できない（5節）
  created_by     TEXT    NOT NULL
  created_at     INTEGER NOT NULL
  INDEX (couple_id, date)
  UNIQUE (couple_id, date) WHERE kind = 'meetup'   -- 会った日は1日1件
```

### `posts` を読むクエリには必ず `deleted_at IS NULL` を含める

**例外なし。**`posts` は論理削除であり、削除された行はテーブルに残り続ける。
条件を書き忘れると、**利用者が消したはずの投稿が別の経路から出てくる。**

`security-requirements.md` 3節の「全てのクエリに `couple_id = ctx.coupleId` を含める」
と同じ強さで扱う。**手続きごとに判断しない。**

| 読む場所 | |
|---|---|
| `post.list` | 一覧 |
| `post.delete` | 対象の特定 |
| `reaction.toggle` | 反応先が生きているかの `EXISTS` |
| `stats.get` | `postCount` と **`photoCount` の両方**（L65） |
| `memory.get` | **4段の探索すべて**（1ヶ月前・半年前・1年前・ランダム。L69） |

**この2つは A が仕様に書き忘れ、R が実装前に見つけた。**
B が自分で書いた実装（`post.list` / `post.delete` / `reaction.toggle`）には
**最初から入っている。**漏れるのは仕様の側である。

`memory.get` が特に悪い。**削除した投稿がホームの最上部に「思い出」として復活する。**
消したという操作が、最も目につく場所で裏切られる。

新しく `posts` を読む手続きを足すときは、**この表に行を足す。**
足せないなら、その手続きは条件を書き忘れている。

### D1 にインタラクティブなトランザクションは無い

**`db.transaction()` を使わない。** D1 は明示的な `BEGIN` / `COMMIT` を受け付けない。
`drizzle-orm/d1` の `transaction()` はそれらを生の SQL として発行する実装のため、
実行時に失敗する（003 で Better Auth を `transaction: false` にしたのも同じ理由）。

原子性が必要な箇所は、次の2つで表現する。

| 手段 | 保証 |
|---|---|
| 単一の SQL 文 | それ自体が原子的 |
| `batch()` | 含まれる全文が全部成功か全部失敗（暗黙のトランザクション） |

したがって「読んでから判断して書く」という形にしない。
**条件を書き込み文の WHERE に埋め込み、更新件数で結果を判定する。**
複数文が必要なら `batch()` にまとめる。
`batch()` は文の**エラー**でロールバックする。更新件数0はエラーではないため、
「起きてはいけない状態」は宣言的制約（UNIQUE / CHECK）でエラーにする。

### 制約の担保箇所

| 制約 | 担保方法 |
|---|---|
| 1人が所属できるペアは1つ | `couple_members.user_id` の UNIQUE 制約 |
| 1ペアは最大2人 | `couple_members.slot` に `CHECK (slot IN (1,2))` と `UNIQUE (couple_id, slot)`。参加時は**空いている最小のスロット**を求め、空きが無ければ `NULL` になって NOT NULL 違反で失敗する（件数から `COUNT(*)+1` で計算しない。行の削除が起きると既存スロットと衝突する） |
| 招待コードは1回だけ有効 | `used_at` を条件に含めた UPDATE の更新件数で判定 |

3つとも**宣言的制約か、条件付き単一文の更新件数**で担保している。
アプリケーション側で数えて判断する箇所は無い。

### 統計の算出（専用テーブルを持たない）

| 指標 | 算出 |
|---|---|
| 付き合って○日目 | JSTの今日 − `couples.anniversary_date` + 1 |
| 会った日数 | `events` の `kind = 'meetup'` の件数。**018 の部分 UNIQUE により1日1件なので日数と一致する**（`requirements.md` 4節） |
| 写真の枚数 | `posts` の **未削除**かつ `image_key IS NOT NULL` の件数 |
| 投稿数 | `posts` の未削除件数 |

**写真の枚数にも「未削除」を付ける。**論理削除した行は `image_key` を残すため
（6節「削除の順序と孤児オブジェクト」）、付け忘れると
**写真の枚数が投稿数を上回る**という、見た目に明らかな矛盾が出る。

## 5. API（oRPC 手続き）

```
me.get              現在のユーザーと所属ペア。未認証ならデモ閲覧モードを返す
couple.create       { anniversaryDate }
couple.get
couple.update       { anniversaryDate }
invite.issue        -> { code, expiresAt }
invite.accept       { code }
post.list           { cursor?, limit } -> { items, nextCursor }
                    items の各要素は投稿者の表示名・プロフィール画像を含む（下記）
post.create         { body, imageId?, imageWidth?, imageHeight? }
                    body を trim した結果と imageId が両方空なら INVALID_INPUT
post.delete         { id }
post.uploadUrl      { contentType } -> { imageId, url }  署名付きPUT・有効期限5分
                    imageId はサーバが生成する（ULID）
reaction.toggle     { postId, kind }
event.list          { from, to } -> { items }
                    範囲は最大400日。超えたら INVALID_INPUT
                    items[].date          射影後の日付（表示する日）
                    items[].sourceDate    登録された日付。repeatYearly でなければ date と同じ
                    items[].time          HH:MM または null
                    items[].createdByName 設定した人の名前。null 許容（LEFT JOIN）
event.create        { date, title, kind, repeatYearly, time? }
                    time は HH:MM。anniversary には付けられない
                    kind='meetup' は同じ日の既存行を上書きする
event.update        { id, ... }
event.delete        { id }
stats.get           -> { daysTogether, meetupDays, postCount, photoCount }
                    daysTogether は判別可能な union
                      dating / dating_upcoming / married / married_upcoming / hidden
                      hidden には days を入れない（非表示が応答にも残らない）
                    daysTogether は判別可能な union
                      { status: "together", days }  記念日が今日以前
                      { status: "upcoming", days }  記念日が未来（「あと○日」）
                    記念日は1年後まで登録できる（打ち間違いの歯止め）
memory.get          -> { post, label } | null
```

### 認可の中心的な設計

**`couple_id` をクライアントから受け取らない。** これがこのアプリの認可の要。

ミドルウェアが以下を組み立て、各手続きは `ctx.coupleId` のみを使う。

```
1. セッションを取得する
2. 認証済み  -> couple_members から couple_id を解決する
                 未所属なら NEEDS_ONBOARDING を返す
   未認証    -> couple_id = デモペアの id、mode = 'readonly'
3. mode が 'readonly' かつ書き込み系の手続き -> FORBIDDEN
4. 全てのクエリを ctx.coupleId で絞る
```

引数に `coupleId` が現れる手続きを作らないことで、
「他ペアのIDを送りつける」攻撃の経路自体が存在しなくなる。
この性質はテストで明示的に証明する（タスク005）。

#### `coupleId` を**含む値**も受け取らない

**R2 のオブジェクトキーは `couples/{coupleId}/posts/{imageId}.jpg` という形をしている。**
これをクライアントから受け取ることは、`coupleId` を受け取ることと同じである。

受け取ってから前綴りを検証する形にはしない。**受け取らない。**

| 受け取るもの | 誰が作るか |
|---|---|
| `imageId` | **サーバ**（`post.uploadUrl` が生成して返す） |
| `image_key` | **サーバ**が `ctx.coupleId` と `imageId` から組み立てる |

クライアントが他ペアの `imageId` を送っても、鍵は `ctx.coupleId` で組み立てられるため
存在しないオブジェクトを指すだけになる。**他ペアの画像に到達する経路が構造上生まれない。**

同じ判断基準を以降の設計にも適用する。
**`ctx.coupleId` から導ける値を、クライアントから受け取らない。**

### 投稿のレスポンスに投稿者情報を含める

`post.list` / `post.create` は、投稿者の表示名とプロフィール画像URLを含めて返す。
タイムラインの投稿カードが投稿者を出すために必要で、投稿1件ごとに別の手続きを
呼ばせない。

| 項目 | 型 | 出どころ |
|---|---|---|
| `authorId` | `string` | `posts.author_id` |
| `authorName` | `string \| null` | `user.name` |
| `authorImage` | `string \| null` | `user.image`（未設定なら `null`） |

- 取得は `user` への **LEFT JOIN** にする
- `authorName` は `user.name` が NOT NULL であっても**レスポンス上は null 許容**に
  する。UI は代替表示（「削除されたユーザー」等）に落とし、
  **投稿本文は必ず読める状態を保つ**
- `post.create` は `ctx` のユーザーからそのまま埋める（`post.list` と同じ値になる）
- この JOIN は `posts` を `couple_id` で絞った結果に対して行う。
  `user` 側を起点に引かない（認可の範囲を JOIN で広げない）

#### 投稿者が引けない状態は、いま到達できない

`posts.author_id` は `user(id)` への**外部キーを持っている**
（`ON DELETE no action`。D1 が実際に強制することを 008 で実測確認した）。
参照されている `user` 行は削除できないため、**「投稿は在るが投稿者が引けない」状態は
現在のスキーマでは作れない。**この経路を再現するテストは書けない。書こうとしても
FK 違反で INSERT 自体が失敗する（`PRAGMA foreign_keys = OFF` は D1 側で無視される）。

#### 子テーブルを持つ親テーブルに、あとから CHECK を足せない

**`PRAGMA foreign_keys = OFF` を D1 が無視することの帰結である**（019 で B が実測）。

SQLite に `ALTER TABLE ... ADD CONSTRAINT` は無い。drizzle-kit は
**新テーブルを作って全行コピーし、旧テーブルを DROP して改名**する。
その手順は `PRAGMA foreign_keys = OFF` を前提にしている。

**D1 はそれを無視して常に FK を強制するため、`DROP TABLE` の時点で失敗する。**
`couples` は `couple_members` / `invites` / `invite_failures` / `events` / `posts` から
参照されており、**実際に `FOREIGN KEY constraint failed` になった。**

**参照されている表は3つだけである**（実測）。

| 親表 | 参照される数 | あとから CHECK を足せるか |
|---|---|---|
| `user` | 8 | **足せない** |
| `couples` | 4 | **足せない** |
| **`posts`** | 1（`reactions` から） | **足せない** |
| 上記以外（`events`・`reactions`・`invites` 等） | 0 | **表を作り直す形が通る**（0006・0009） |

**`events` は参照されていない。**014 の CHECK 追加（0009）は**通る。**
`reactions` の 0006 が通ったのと同じである。

親表に制約を足すときは、

| 制約の形 | 書き方 |
|---|---|
| 自列だけを見る | `ALTER TABLE ADD COLUMN` の CHECK 句に付けられる |
| **複数列にまたがる** | **TRIGGER**（`BEFORE INSERT` と `BEFORE UPDATE` の両方） |

**TRIGGER は drizzle のスキーマファイルに現れない。**
`packages/db/src/schema/*.ts` を読んだ人には見えないので、
**そこにコメントで書く。**書かないと、スキーマファイルが実態より弱く見える。

それでも LEFT JOIN と null 許容を採る。**理由は「いま起きるから」ではなく、
これが崩れたときの壊れ方が悪いからである。**

| | INNER JOIN + NOT NULL | LEFT JOIN + null 許容 |
|---|---|---|
| FK が今のままなら | 同じ | 同じ |
| `ON DELETE` が将来変わったら | **投稿が一覧から黙って消える** | 投稿者名が欠けて表示される |
| いま払うコスト | なし | UI の代替表示1つ（**現時点では到達不能なので実行されない**） |

`ON DELETE` の指定は、アカウント削除機能を作るときに触る蓋然性が高い箇所である。
そのとき契約とマイグレーションと UI を同時に直すより、いま代替表示を1つ持つ方が安い。

**代替表示のコードは現時点では実行されない。**テストで緑になっていることを
根拠に「守られている」と言わないこと。守っているのは FK であって UI ではない。

- この JOIN は `posts` を `couple_id` で絞った結果に対して行う。
  `user` 側を起点に引かない（認可の範囲を JOIN で広げない）

**`authorImage` は Google のホストを指す外部URLである。**
R2 の署名付きURL（6節）とは別物で、有効期限も無い。この結果として:

- Web で表示するには CSP の `img-src` にこのホストを許可する必要がある
  （`state.md` L13 のセキュリティヘッダ対応時に忘れない）
- 画像の取得リクエストが Google に飛ぶ。利用者は Google でログインしている以上
  新たに渡る情報はほぼ無いが、自前でホストしていないことは意識しておく

R2 に取り込んで自前配信する案は取らない。プロフィール画像は「最高」区分のデータでは
なく（`security-requirements.md` 1節）、取り込みは同期・失効・容量の管理を新たに
抱え込む。割に合わない。

### 繰り返し記念日の射影

`repeat_yearly = true` の記念日は、**照会範囲が触れる年それぞれに射影して返す。**

#### 範囲が年をまたぐことを前提にする

**月表示のカレンダーは12月と1月で必ず年をまたぐ。**
011 のグリッドは日〜土なので、2026年12月は `2026-11-29 〜 2027-01-02`、
2027年1月は `2026-12-27 〜 2027-02-06` になる（実測）。
「範囲を同一年に制限する」形にすると、**011 が2回に分けて呼ばざるを得ない。**

範囲が触れる年（`from` の年から `to` の年まで）それぞれに `MM-DD` を当てはめ、
`from`〜`to` に入るものを返す。

- **範囲は最大400日。**超えたら `INVALID_INPUT`。射影の回数と D1 の行読み取りを
  有界にする。月グリッド（最大42日）と年表示（366日）を十分に覆う
- **射影する年を決め打ちにしない。**`year(from)` から `year(to)` までを必ずループする。
  当初ここに「上限があるため射影する年は最大2つ」と書いたが**誤りだった**（下記）
- **同じ記念日が2回現れることがある。**400日の窓は同じ `MM-DD` を2度含みうる
  （`2026-01-01 〜 2027-02-05` は 01-15 を2回含む）。
  **重複を除去しない。**それぞれ別の出現である
- クライアントは `(id, date)` で1件を識別する。`id` だけでは一意にならない

#### 「触れる暦年の数」と「同じ日付が出る回数」は別物

当初この節に「上限があるため、射影する年は**最大2つ**」と書いた。**誤りである。**
2つの数を混同していた。

| | 上限 | 根拠 |
|---|---|---|
| 同じ `MM-DD` が窓に出る回数 | **最大2回** | 400 < 730 |
| 窓が触れる**暦年**の数 | **最大3つ** | 下記 |

`2026-12-20 〜 2028-01-24` はちょうど400日で、**2026・2027・2028 の3年に触れる**（実測）。

このとき `MM-DD = 06-15` の記念日が窓に入るのは **2027-06-15 だけ**である。
`year(from)` と `year(to)` の2年しか射影しないと、
2026-06-15 は窓より前、2028-06-15 は窓より後になり、**記念日が丸ごと消える。**

**中間の年を落とす形なので、端だけ見ていると気づかない。**
必ず `year(from)` から `year(to)` までをループすること。

#### 平年の 02-29 は 02-28 に寄せる

**03-01 にしない。**理由は2つ。

1. **`2024-02-29 + 365日 = 2025-02-28`。**平年の365日後がちょうどそこに当たる
2. **カレンダーが月単位である。**03-01 に寄せると、
   **2月の記念日が平年の2月の表示から消える。**利用者から見て違和感が大きい

**保存されている `date` は `02-29` のまま変えない。**射影だけが動く。
うるう年へ射影するときは `02-29` のまま返す。

これは下の一般則の一例である。

### 日付計算は `packages/date` に置く

**`new Date(...)` を `packages/date` の外で書かない。ESLint で禁止する。**

011 の実装で、`todayJst` が `apps/app/lib/calendar.ts` と `apps/api/src/lib/date.ts` の
**2箇所に同名で存在する**状態になった（L63）。`apps/app` は `apps/api` に依存しない
構成なので、そのままでは避けられない。

**危ないのは「今日が何日か」の定義が2つあること。**ずれると、
カレンダーが強調する「今日」と `memory.get` が見る「今日」が別の日になる。
**どちらも正しく動いているように見えて、表示だけが食い違う。**

そしてこの節の1つ下の規則（存在しない日付は月末に寄せる）も、
実装が2箇所にあれば**規則も2つになりうる。**規則を1つにした意味が消える。

| 置き場所 | 中身 |
|---|---|
| **`packages/date`** | `todayJst` / うるう年・月の日数 / 年月の加減算 / 月末クランプ / 日数差 |
| `apps/app` | 週のラベル、月の見出し、グリッドの組み立て。**表示に関わるものだけ** |
| `apps/api` | 手続き固有の組み合わせ。**計算そのものは持たない** |

`packages/contract` に入れない。**あれは「型の単一の源」であって道具箱ではない。**
用途を混ぜると、次に共有したいものが出たときも同じ場所に積まれる。

#### 禁止するのは `new Date(...)` だけ。`Date.now()` は禁止しない

当初「`new Date()` と `Date.now()` を禁止する」と書いた。**雑だった。**
実装したところ、暦と無関係な既存コードまで止まった（B の報告）。

**`Date.now()` は数値を1つ返すだけで、暦日を作れない。**
タイムゾーンも日付境界も関与しないので、重複しても「今日が何日か」の答えは割れない。

**`new Date(...)` が境界である。**ここで初めて暦とタイムゾーンの解釈が入る
（`getFullYear`・`toISOString`・`toLocaleDateString`）。禁止するのはこちらだけでよい。

| 書き方 | 扱い |
|---|---|
| `Date.now()` / `Math.floor(Date.now()/1000)` | **禁止しない。**`created_at` や ULID の種はこれで足りる |
| `new Date(...)` | **`packages/date` の外で禁止** |
| テストファイル | 対象外。固定値の生成であって暦日計算ではない |

**`eslint-disable` を並べて通す形にしない。**必要なものは `packages/date` に
関数として置き、そこを通す。除外が増え続ける規則は、いずれ本物の違反を隠す
（`conventions.md` 8節でスクリーンショット要件を撤回したのと同じ理由）。

#### 表示のための整形も `packages/date` に置く

`toLocaleDateString` / `toLocaleString` は、**`timeZone` を指定しなければ
端末のタイムゾーンで解釈される。**このアプリは JST 固定である
（`conventions.md` 6節）。端末が別のタイムゾーンなら、
**投稿の日付が1日ずれて表示される。**

整形も `packages/date` に置き、**JST を明示する。**
`new Date(...)` を外で書かせない規則は、これも自動的に拾う。


### `repeatYearly` は `anniversary` にしか立てられない

`events.repeat_yearly` の列コメントは当初から「**記念日のみ 1**」と書いていたが、
**入力スキーマは `kind` と無関係に `boolean` を受けていた。**
`meetup` に `repeatYearly: true` を立てられる。
**ドキュメントが実在しない統制を主張している状態**である（R の指摘・L67）。

立ってしまうと、「会った日」が毎年のカレンダーに繰り返し現れる。
**実際には1度しか会っていない日が、毎年あったことになる。**

**入力スキーマで拒否する。**`kind !== "anniversary"` かつ `repeatYearly === true` を
`INVALID_INPUT` にする。`event.create` と `event.update` の両方。

DB の CHECK 制約は置かない。**書き込み口が入力スキーマの1つしか無く、
そこで弾けば到達しない。**（`posts.image_key` の UNIQUE を宣言的制約にしたのは、
「複数行を数えて判断する」形を避けるためであり、この場合とは事情が違う）

### `anniversary` には `time` を設定できない

**同じ理由で、入力スキーマで拒否する。**
記念日は**「日」であって時刻を持つ概念ではない。**毎年射影される性質とも
噛み合わない（「毎年 5/18 14:30」は意味を成さない）。

`time` は `HH:MM` の文字列で持つ。**JST の壁時計としての時刻**であって
ある瞬間ではない。`date` を `YYYY-MM-DD` で持つのと同じ理由である（4節）。

### 「会った日」は1日1件

**部分 UNIQUE インデックスで表す。**

```sql
CREATE UNIQUE INDEX events_meetup_unique
  ON events (couple_id, date) WHERE kind = 'meetup';
```

上の `repeatYearly` と扱いが違うのは、**こちらが「複数行の関係」だから**である。
1行の中の整合（`kind` と `repeatYearly`）は入力スキーマで足りるが、
**「同じ日に他の行があるか」はアプリケーション側で数えることになる。**
`posts.image_key` の UNIQUE と同じ理由で、**宣言的制約にする。**

- `event.create` は `ON CONFLICT ... DO UPDATE` で**上書きする。**
  人間の要望が「後に設定したもので上書き」だからである。
  **1文で済み、D1 にトランザクションが無くても原子性が保たれる**（4節）
- **`event.update` は上書きしない。**衝突したら `INVALID_INPUT` を返す。
  `create` は「この日は会った日だ」という宣言だが、
  `update` は特定の1件の編集であり、**別の行が黙って消えるのは意図と違う**

### 存在しない日付は、その月の末日に寄せる

**日付計算で存在しない日ができたら、常にその月の末日へ寄せる。翌月へ繰り上げない。**
`apps/api/src/lib/date.ts` の全ての関数がこの規則に従う。

| 場面 | 入力 | 結果 |
|---|---|---|
| 記念日の射影（上記） | `02-29` を平年へ | `02-28` |
| **`monthsBefore`** | `2026-03-31` の1ヶ月前 | **`2026-02-28`** |
| **`yearsBefore`** | `2028-02-29` の1年前 | **`2027-02-28`** |

#### JavaScript の `Date` に任せない

**素の `Date` は逆の答えを返す。**存在しない日を翌月へ繰り上げる。

```
2026-03-31 の1ヶ月前  → 2026-03-03   (2月31日 = 3月3日)
2028-02-29 の1年前    → 2027-03-01
```

1つ目は**利用者から見て明確な誤り**である。013 の「ちょうど1ヶ月前の投稿」で
3月31日に3月3日の投稿が出る。**28日前を「1ヶ月前」と呼ぶことになる。**

2つ目はもっと悪い。**射影の規則（`02-29` → `02-28`）と正面から矛盾する。**
同じ「存在しない 2月29日をどうするか」に、同じコードベースが
`02-28` と `03-01` の2つの答えを持つことになる。

**規則を場面ごとに分けない。1つにする。**005 の認可を1箇所に集約したのと同じ理由で、
分けた瞬間にどこかが食い違う。

#### `memory.get` への影響

3月29日・30日・31日の「1ヶ月前」は**3日とも 2月28日**になる（平年）。
2月28日の投稿が3日続けて「1ヶ月前」として出ることがある。

**不具合ではない。**どの日から見ても2月28日が「1ヶ月前」であることは正しい。
月末の日数差から必然的にそうなる。**そう見えたときに直そうとしないこと。**

### `memory.get` の探索順

1. ちょうど1ヶ月前の投稿
2. ちょうど半年前の投稿
3. ちょうど1年前の投稿
4. 上記が無ければ、7日以上前の投稿からランダムに1件
5. それも無ければ `null`（UIはカードごと非表示）

## 6. 画像の扱い

- R2 バケットは**非公開**。公開URLを発行しない
- オブジェクトキー: `couples/{coupleId}/posts/{imageId}.jpg`。
  **鍵はサーバだけが組み立てる。クライアントに鍵を渡さないし、受け取らない**（5節）
- アップロード: `post.uploadUrl` が `imageId`（ULID）を生成し、その鍵に対する
  署名付き PUT URL（5分）を返す。クライアントは R2 へ直接送る。
  **画像本体は Worker を経由しない**
- 表示: `post.list` のレスポンスに署名付き GET URL（1時間）を含める。
  鍵は行の `couple_id` と `image_key` から作る
- クライアント側で長辺 1600px / JPEG 品質 0.8 に圧縮してから送る

### R2 バケットに CORS を設定する（設定しないとアップロードが動かない）

**ブラウザが署名付き URL へ直接 PUT するため、バケット側の CORS が要る。**
設定が無いとブラウザがリクエストをブロックし、`post.create` は
「実体が無い」と判断して `INVALID_INPUT` を返す。
**症状はサーバ側のバリデーション失敗に見えるが、原因はバケットの設定である。**

この記載が無かったために、008・009 の実機確認で原因の特定に時間を要した（L34）。

- 許可するのは **`PUT` と `GET`**
- 許可するオリジンは**開発と本番の実際のオリジンだけ**を列挙する。
  `*` を設定しない（`security-requirements.md` 7節）
- 本番オリジンは 016 で公開URLが決まってから追加する。**追加を忘れると本番で
  画像アップロードだけが失敗する**

```bash
wrangler r2 bucket cors list futary-images    # 現在の設定を見る
wrangler r2 bucket cors set futary-images --file <ルール>.json
```

Worker の CORS（`TRUSTED_ORIGINS`）とは**別の設定**である。片方を直しても
もう片方は変わらない。

### ローカル D1 とリモート D1 は別物である

`db:migrate:local` はローカルのエミュレータにしか適用されない。
**リモート（実クラウド）の D1 には `db:migrate:remote` が要る。**

008・009 の実機確認で `wrangler dev --remote` に切り替えたとき、
リモート D1 にマイグレーションが一度も適用されておらず（`num_tables: 0`）、
**ログインが全滅した**（L34）。それまでの開発が全てローカル側だけで完結していたため、
ずれていることに気づく機会が無かった。

**適用漏れを人間の記憶に頼らない。**

- **デプロイのワークフローが `db:migrate:remote` を実行してから deploy する**（016）
- `wrangler dev --remote` を使う前は、リモート側のマイグレーションが
  最新であることを確認する

### 画像の実体と行の対応を1対1に保つ

`image_key` が非NULLなら **R2 に実体がある**、という不変条件を保つ。
保たないと、`post.list` が存在しないオブジェクトに署名して壊れた画像が出る。

| 崩れ方 | 塞ぎ方 |
|---|---|
| 未アップロードの `imageId` で投稿が作れる | `post.create` で **R2 に実体があることを確認**してから書く。無ければ `INVALID_INPUT` |
| 同じ `imageId` を複数の投稿が参照する | `posts.image_key` の **UNIQUE 制約**。片方を消すともう片方が壊れるため |

2つ目はアプリケーション側で数えて判断しない。**宣言的制約でエラーにする**（4節の方針と同じ）。
論理削除した行も `image_key` を残すため、削除済みの `imageId` は再利用できない。
実体が孤児として残っている可能性があるので、これは正しい振る舞いになる。

どちらも自ペア内に閉じており、安全上の問題ではない。**表示が壊れることを防ぐための制約。**

### 削除の順序と孤児オブジェクト

**D1 と R2 にまたがる原子性は作れない。** 別サービスであり、トランザクションを張れない。
どちらを先にしても片方が失敗する形が残る。

| 順序 | 失敗したときに起きること |
|---|---|
| R2 → D1 | 投稿は残るのに画像が消える。**一覧に壊れた表示が出る** |
| **D1 → R2** | 孤児オブジェクトが残る。**利用者からは見えない** |

**D1 を先にする。** 利用者から見える壊れ方が無い方を選ぶ。

- `post.delete` は `deleted_at` を立てたあと R2 の削除を試みる
- **R2 の削除に失敗しても `post.delete` は成功として返す。**
  利用者の操作を、掃除の失敗で失敗させない
- **`image_key` を消さない。** 論理削除した行に鍵を残すことで、
  孤児を後から回収できる状態を保つ
- 定期的な回収は MVP では実装しない。**回収可能であることだけを設計として担保する**

## 7. デザイントークン

サンプル（`docs/sample/sample.png`）から抽出した値。
実際に画面に出してから微調整してよい。変更する場合は `packages/ui` の1箇所だけを直す。

### 色

| トークン | 値 | 用途 |
|---|---|---|
| `bg` | `#FEF6F3` | 画面の地。淡い暖色 |
| `surface` | `#FFFFFF` | カード |
| `surface-tint` | `#FCEEEC` | 選択中・強調されたカード |
| `primary` | `#F5868D` | ボタン、FAB、アクティブなタブ、ハート |
| `primary-pressed` | `#E4707A` | 押下時 |
| `primary-subtle` | `#FCE4E4` | バッジ・タグの地 |
| `brand-ink` | `#7B4A3C` | ロゴ・見出しの茶 |
| `text` | `#4A3733` | 本文 |
| `text-muted` | `#A08C87` | 補助テキスト・日付 |
| `border` | `#F2E0DC` | 区切り線・カード枠 |
| `overlay` | `rgba(20, 15, 14, 0.92)` | 画像の全画面表示（017）の背景。ブランドカラーとは無関係な機能色 |
| `event-anniversary` | `#E36387` | カレンダー（011）記念日マーカー |
| `event-plan` | `#D9A441` | カレンダー（011）予定マーカー |
| `event-meetup` | `#4C8C8B` | カレンダー（011）会った日マーカー |

### 形

| トークン | 値 |
|---|---|
| `radius.card` | 20 |
| `radius.input` | 14 |
| `radius.pill` | 999 |
| `space` | 4 / 8 / 12 / 16 / 24 / 32 |
| `shadow.card` | 極薄（不透明度 0.04、ぼかし 12、下方向 2、elevation 2） |
| `shadow.fab` | FAB 用（不透明度 0.15、ぼかし 6、下方向 3、elevation 4） |

`shadow.fab` はカードより濃い。FAB は背景の上に浮いている必要があり、
`shadow.card` の濃度では画面に沈んで押せることが伝わらないため。

### レイアウト

| トークン | 値 | 用途 |
|---|---|---|
| `layout.maxWidth` | 640 | **本文列の最大幅。**PC 幅で内容が横に伸び切るのを防ぐ |

**640 にする理由は画像の保存解像度にある。**
投稿画像はクライアントで**長辺 1600px**に圧縮して保存する（6節）。
表示幅 640 CSS px は、Retina（2倍）でも 1280 device px であり、**元画像の内側に収まる。**
800 にすると 2 倍で 1600 ちょうどになり、余裕が無くなる。
**表示幅は保存解像度から決める。**読みやすさの目安（本文列 600〜700px）とも矛盾しない。

#### `Screen` が既定で適用する。呼び出し側に書かせない

**幅の制約は `packages/ui` の `Screen` が持つ。**各画面がラッパーを書く形にしない。

呼び出し側に任せると、005 の認可・`Button` の二重発火で潰したのと同じ形になる。

> 手続きごとに認可を書くと、必ずどこかで書き忘れる（`security-requirements.md` 3節）

**既定で制約し、外す画面だけが明示的に外す。**逸脱が差分に現れる形にする。
全画面に手で足す形だと、足し忘れた画面は**何事もなかったように広がる。**

- 制約を外す必要がある画面は `Screen` に明示的な指定で opt out する
- **画像の全画面表示（017）には適用しない。**あれは `Screen` ではなくモーダルであり、
  画面いっぱいに写真を出すことが目的である。**幅を絞ったら要望を満たさない**

### ボタンのバリアント

| バリアント | 見た目 | 用途 |
|---|---|---|
| `primary` | `primary` 地に白文字 | 画面で最も進めたい操作。1画面に1つ |
| `secondary` | `surface` 地 + `border` の枠線 | 主操作と並ぶが従属する操作 |
| `ghost` | 地なし。押下時のみ `surface-tint` | 取り消し・戻るなど、目立たせない操作 |

### 文字

- 本文はシステムフォント。Web フォントを読み込まない（初回表示を速く保つ）
- ロゴの手書き風スクリプト体は**画像アセット**として持つ。フォントのライセンス問題を避け、
  Web フォントの追加読み込みも発生させない

### ナビゲーション

**ボトムタブ5つ: ホーム / カレンダー / ＋投稿 / 検索 / マイページ。**

当初は「ホーム / **アルバム** / ＋投稿 / 検索 / マイページ」で、
「タブを4つに減らすとデザインの印象が変わるため、枠は残す」としていた。
**アルバムをカレンダーに置き換えた。**理由は下記。

`検索` は枠のみ（「準備中」を表示）。扱いは 016 の仕上げで決める（`state.md` L71）。

### 画面の外枠（ボトムタブ）は常に出す

**人間が M3 の実機確認で報告した。**カレンダー画面でボトムタブが消え、
**前の画面に戻れなくなった。**

原因は `calendar.tsx` が `(tabs)` の外に置かれ、`Stack` で push されていたこと。
ヘッダーの戻るはあるが、**Web では確実に出るとは限らない。**
タブが消えた時点で、その画面から出る手段が環境依存になっていた。

**規則。**

- **ボトムタブを消さない。**画面を `(tabs)` の外に置かない
- 例外は**モーダル**だけ（`compose`）。モーダルは**閉じる導線を必ず自前で持つ。**
  ヘッダーの戻る／閉じるに依存しない（017 の閉じる導線3つと同じ考え方）
- **押して進んだ先から、必ず戻れること。**戻れるかどうかを
  プラットフォームの既定に委ねない

### タブに出すのは動く機能

**カレンダーをタブにする。`アルバム` を置き換える。**

置き換える前は5つのタブのうち**2つ（アルバム・検索）が「準備中です」**で、
**MVP 機能であるカレンダーはタブに無く、ホームのボタン1つからしか行けなかった。**

- アルバムは「既存データの見せ方を変えるだけ」で**次フェーズ**（`requirements.md` 5節）
- カレンダーは MVP の機能である（記念日・予定・会った日）

**動くものをタブに出し、動かないものを引っ込める。**
デモは公開前提であり、**最初に触る画面で「準備中です」に当たるのは弱い。**


## 8. 環境と秘密情報

| 変数 | 用途 | 置き場所 |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth | ローカル `.dev.vars` / 本番 `wrangler secret` |
| `BETTER_AUTH_SECRET` | セッション署名 | 同上 |
| `BETTER_AUTH_URL` | コールバックURL | ローカル `.dev.vars` / 本番 `wrangler secret` |
| `TRUSTED_ORIGINS` | CORS の許可オリジン | 同上 |
| `DB` | D1 バインディング | `wrangler.toml` |
| `BUCKET` | R2 バインディング | `wrangler.toml` |
| `DEMO_COUPLE_ID` | デモペアの id | `wrangler.toml` の vars |

`.dev.vars` は `.gitignore` に入れる。秘密情報をコードに書かない。

### `BETTER_AUTH_URL` と `TRUSTED_ORIGINS` を vars に置かない理由

当初この2つは `wrangler.toml` の `vars` に置く設計だった。003 の監査で
以下の High 指摘が出たため、環境ごとの値として `.dev.vars` / `wrangler secret` に移した。

- `BETTER_AUTH_URL` が `http` のままだと Cookie の `Secure` 属性が落ちる
- `wrangler.toml` は**コミットされるファイル**であり、環境ごとに値を切り替えられない。
  開発用の値が本番に混入する経路になる

**この2つは機密データではない。** 移した理由は秘匿ではなく、
「環境ごとに切り替わる値をコミット対象のファイルに焼き付けない」こと。

### `BETTER_AUTH_URL` の検証規則

起動時に検証し、不正なら即座に失敗させる（fail-fast）。判定はホスト名で行う。
環境を示す変数（`NODE_ENV` 等）を新設しない。**環境変数で分岐させると、
本番で開発用の値が設定された場合に検証をすり抜ける**からである。

| ホスト | `http` | `https` |
|---|---|---|
| `localhost` / `127.0.0.1` / `[::1]` | 許可 | 許可 |
| それ以外 | **拒否して起動失敗** | 許可 |

ローカル開発は `http://localhost:8787` で通り、それ以外のホストでは
`https` 以外を受け付けない。この規則はコードで実装し、テストで検証する。
`TRUSTED_ORIGINS` にも同じ規則を適用する。
