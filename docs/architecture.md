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
  repeat_yearly  INTEGER NOT NULL DEFAULT 0  -- 記念日のみ 1
  created_by     TEXT    NOT NULL
  created_at     INTEGER NOT NULL
  INDEX (couple_id, date)
```

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
| 会った回数 | `events` の `kind = 'meetup'` の件数 |
| 写真の枚数 | `posts` の `image_key IS NOT NULL` の件数 |
| 投稿数 | `posts` の未削除件数 |

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
                    items[].date       射影後の日付（表示する日）
                    items[].sourceDate 登録された日付。repeatYearly でなければ date と同じ
event.create        { date, title, kind, repeatYearly }
event.update        { id, ... }
event.delete        { id }
stats.get           -> { daysTogether, meetupCount, postCount, photoCount }
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
  有界にする。月グリッド（最大42日）と年表示（366日）を十分に覆う。
  上限があるため、射影する年は**最大2つ**になる
- **同じ記念日が2回現れることがある。**400日の窓は同じ `MM-DD` を2度含みうる
  （`2026-01-01 〜 2027-02-05` は 01-15 を2回含む）。
  **重複を除去しない。**それぞれ別の出現である
- クライアントは `(id, date)` で1件を識別する。`id` だけでは一意にならない

#### 平年の 02-29 は 02-28 に寄せる

**03-01 にしない。**理由は2つ。

1. **`2024-02-29 + 365日 = 2025-02-28`。**平年の365日後がちょうどそこに当たる
2. **カレンダーが月単位である。**03-01 に寄せると、
   **2月の記念日が平年の2月の表示から消える。**利用者から見て違和感が大きい

**保存されている `date` は `02-29` のまま変えない。**射影だけが動く。
うるう年へ射影するときは `02-29` のまま返す。

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

ボトムタブ5つ: ホーム / アルバム / ＋投稿 / 検索 / マイページ。
MVP では **アルバム と 検索 は枠のみ**（「準備中」を表示）。
タブを4つに減らすとデザインの印象が変わるため、枠は残す。

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
