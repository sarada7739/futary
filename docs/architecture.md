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
  image_key    TEXT                          -- R2 オブジェクトキー
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
post.create         { body, imageKey?, imageWidth?, imageHeight? }
                    body を trim した結果と imageKey が両方空なら INVALID_INPUT
post.delete         { id }
post.uploadUrl      { contentType } -> { key, url }   署名付きPUT・有効期限5分
reaction.toggle     { postId, kind }
event.list          { from, to }
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

### `memory.get` の探索順

1. ちょうど1ヶ月前の投稿
2. ちょうど半年前の投稿
3. ちょうど1年前の投稿
4. 上記が無ければ、7日以上前の投稿からランダムに1件
5. それも無ければ `null`（UIはカードごと非表示）

## 6. 画像の扱い

- R2 バケットは**非公開**。公開URLを発行しない
- オブジェクトキー: `couples/{coupleId}/posts/{postId}.jpg`
- アップロード: Worker が署名付き PUT URL（5分）を発行し、クライアントが R2 へ直接送る。画像本体は Worker を経由しない
- 表示: `post.list` のレスポンスに署名付き GET URL（1時間）を含める
- クライアント側で長辺 1600px / JPEG 品質 0.8 に圧縮してから送る
- 投稿削除時は R2 オブジェクトも削除する

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
