# 007: 画像アップロード（R2）

## 目的
投稿に画像1枚を添付できるようにする。
Worker が画像本体を経由しない構成にし、CPU時間とサイズ制限を回避する。

## 変更対象ファイル
- （新規）`apps/api/src/procedures/upload.ts` — `post.uploadUrl`
- （新規）`apps/api/src/lib/r2-signed-url.ts`
- `apps/api/src/procedures/post.ts` — `post.list` の応答に署名付き GET URL を含める
- `apps/api/src/procedures/post.ts` — `post.delete` で R2 オブジェクトも削除する
- （新規）`apps/app/lib/image.ts` — クライアント側の圧縮とアップロード
- `apps/api/wrangler.toml` — R2 バインディング

## 実装内容

### 前提: `apps/app` にテスト基盤を用意する（このタスクで導入する）

**`apps/app` にはテストが1件も無い。** M1 の実機確認で見つかった2件
（`callbackURL` の相対パス、ボタンの二重発火）は手で触って初めて分かったもので、
**退行しても誰も気づけない**（旧 L27）。

006 までは全てサーバ側で、既存の API テスト基盤で足りていた。
**クライアント側のロジックが最初に出るのがこのタスク（画像圧縮）**なので、ここで入れる。

- Vitest + React Native Testing Library を `apps/app` に導入する
- CI（`.github/workflows/ci.yml`）で実行されるようにする
- このタスクで**最低2件**書く
  1. 画像圧縮のユーティリティ（長辺と品質の適用、非対応形式の扱い）
  2. **`Button` を素早く2回押しても `onPress` が1回しか走らないこと**
     （`conventions.md` 4節。旧 L26。この回帰テストが無いと同じ不具合が戻る）
- URL を組み立てる箇所があれば、**絶対URLになることをテストする**
  （`callbackURL` の相対パス問題と同じ形）

Playwright による E2E はこのタスクで入れない。
認証が Google OAuth のため自動化が重い。**014 のデモ経路は未認証で E2E しやすい**ので、
そちらで導入する（`conventions.md` 6節の E2E 規定はそのタイミングで満たす）。

### 本体

- **`post.create` に「本文か画像のどちらかは必須」を入れる**（旧 L30）
  - `body` を trim した結果が空で、かつ `imageId` も無いなら `INVALID_INPUT`
  - 006 の時点では画像が無かったため下限が無く、**両方空の投稿を作れる状態だった**
  - 画像が入るこのタスクで、両方空を弾く形に揃える
  - 空白のみの本文も空として扱う。テストで両方空・空白のみの2ケースを検証する
- **オブジェクトキーをクライアントから受け取らない**（`architecture.md` 5節）
  - `imageKey` は `couples/{coupleId}/...` という形をしており、
    **受け取ることは `coupleId` を受け取ることと同じ**になる
  - 006 の契約は `imageKey: z.string().optional()` を `ctx.coupleId` と照合せずに
    INSERT していた。**007 で `post.list` が署名を発行すると、
    他ペアの鍵を送りつけて画像を読める形になる**（007 R-1 指摘）
  - **受け取ってから前綴りを検証する形にしない。受け取るのをやめる**
  - `packages/contract` の `post.create` から `imageKey` を外し、`imageId` にする
- `post.uploadUrl`: `contentType` を受け取り、`{ imageId, url }` を返す
  - **`imageId`（ULID）はサーバが生成する**
  - 鍵 `couples/{ctx.coupleId}/posts/{imageId}.jpg` はサーバだけが組み立てる。
    **クライアントに鍵そのものを返さない**
  - 有効期限 **5分**
  - `contentType` を `image/jpeg` に限定して検証する
  - サイズ上限を設定する（例: 8MB）
  - `writeProcedure` の上に載せる（デモからは呼べない）
- `post.create` は `imageId` を受け取り、**サーバが `image_key` を組み立てて保存する**
- **`image_key` が非NULLなら R2 に実体がある**、という不変条件を保つ（`architecture.md` 6節）
  - `post.create` で **R2 に実体があることを確認**してから書く（`env.BUCKET.head(key)`）。
    無ければ `INVALID_INPUT`。**未アップロードの `imageId` で投稿を作らせない**
  - `posts.image_key` に **UNIQUE 制約**を付ける（マイグレーションが要る）。
    同じ `imageId` を複数の投稿が参照すると、片方を消したときもう片方が壊れる
  - どちらも自ペア内に閉じており安全上の問題ではない。**表示が壊れることを防ぐ**
- クライアント側で圧縮してからアップロードする
  - 長辺 **1600px**、JPEG 品質 **0.8**
  - 圧縮後に署名付き PUT URL へ直接送る。Worker を経由しない
- `post.list` の応答に署名付き GET URL（有効期限 **1時間**）を含める
- `post.delete` の削除順序（`architecture.md` 6節）
  - **D1 を先に更新し、そのあと R2 の削除を試みる**
  - **R2 の削除に失敗しても `post.delete` は成功として返す。**
    利用者の操作を、掃除の失敗で失敗させない
  - **`image_key` を消さない。** 論理削除した行に鍵を残し、孤児を後から回収できる状態を保つ
  - 定期的な回収は**このタスクで実装しない**。回収可能であることだけを担保する
  - D1 と R2 にまたがる原子性は作れない（別サービス）。
    「孤児オブジェクトを残さない」は実現できないため、要求から外した（007 R-2 指摘）

## セキュリティ上の必須事項
`docs/security-requirements.md` 5節に従う。
- **R2 バケットに公開URL・カスタムドメインを設定しない**
- キーに推測可能な連番を使わない
- 署名付きURLの有効期限を必ず設定する（無期限にしない）

## 確認観点
- 署名なしで R2 のオブジェクトに直接アクセスできないこと
- 署名付きURLが期限切れ後にアクセスできなくなること
- 大きな画像が圧縮されてからアップロードされること（アップロード後のファイルサイズを確認する）
- 投稿を削除したら R2 からもオブジェクトが消えること
- デモモード（未認証）で `post.uploadUrl` が `FORBIDDEN` になること
- **手続きの入力に `imageKey`（鍵そのもの）が現れないこと。** grep で確認できるか
- **他ペアの `imageId` を送っても他ペアの画像に到達しないこと**
  （鍵は `ctx.coupleId` で組み立てられるため、存在しないオブジェクトを指すだけになる）
- R2 の削除に失敗しても `post.delete` が成功すること
- **未アップロードの `imageId` で `post.create` が拒否されること**
- **同じ `imageId` を2つの投稿で使えないこと**（UNIQUE 制約で落ちること）

## 完了条件
- [ ] `apps/app` にテスト基盤があり、CI で実行される
- [ ] `Button` の二重発火を防ぐ回帰テストが緑（`conventions.md` 4節）
- [ ] 画像付きの投稿ができ、一覧に表示される
- [ ] 署名なしアクセスが拒否されることを確認済み
- [ ] 投稿削除で R2 オブジェクトも消える（失敗しても `post.delete` は成功する）
- [ ] **他ペアの `imageId` を送っても他ペアの画像に到達しないことがテストで証明されている**
- [ ] テストが緑。005 の認可テストも緑
- [ ] **security-auditor の指摘で High 以上がゼロ**（画像アップロードを触るタスクのため必須）
- [ ] `artifacts/007/` に証跡（アップロード前後のファイルサイズ、署名なしアクセスの拒否結果）を保存

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション

## 進捗
- [x] `post.create` の「本文か画像のどちらかは必須」（旧 L30）
- [x] `apps/app` のテスト基盤導入（Vitest、CI 連携）
- [x] `Button` の二重発火ガードと回帰テスト
- [x] R2 バインディング設定（`wrangler.toml` に既存。今回追加したのは署名用の
      S3互換API認証情報 `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`）
- [x] `packages/contract` の `post.create` から `imageKey` を外し `imageId` にする
- [x] `post.uploadUrl`（`imageId` をサーバ生成・署名付きPUT・5分・contentType検証）
- [x] クライアント側の圧縮（1600px / 0.8）
- [x] `post.list` に署名付きGET URL（1時間）
- [x] `posts.image_key` の UNIQUE 制約（マイグレーション）
- [x] `post.create` の実体確認（R2 head）
- [x] `post.delete` の削除順序（D1 → R2、失敗を握りつぶす、`image_key` を残す）
- [x] 署名なしアクセスの拒否確認（実機。R2 APIトークン設定後に確認済み。
      下記「実装メモ」・`artifacts/007/manual-check.md`参照。一部制約あり）
- [x] security-auditor 実行（High以上ゼロ。Medium 4件中3件・Low 1件中1件を対応。
      詳細は `docs/security-report.md` と `artifacts/007/security-audit-raw.md`）
- [x] 証跡保存 → `state.md` 更新 → `worklog.md` 追記

## 実装メモ（B）

- **テストライブラリは React Native Testing Library ではなく `@testing-library/react`
  （DOM版）+ `react-native-web` エイリアス + jsdom にした。** react-native 0.86 +
  React 19 の組み合わせで `@testing-library/react-native`（react-test-renderer 経由）を
  試したが、react-native 本体のソースが Flow 構文を含み Vitest（esbuild/rolldown）で
  変換できず断念した（`Flow is not supported` エラー）。アプリ本体が RN Web で
  単一コードベースになっている（architecture.md 1節）のと同じ考え方で、
  `resolve.alias` で `react-native` を `react-native-web` に差し替えて jsdom 上で
  レンダーする方式に切り替えた。同じ理由で `react-native-safe-area-context`
  （ネイティブモジュール）もテスト用の最小モックに差し替えている
  （`apps/app/test/mocks/react-native-safe-area-context.tsx`）。挙動としては
  「Button を素早く2回押しても onPress が1回しか走らないこと」を実際に検証できており、
  タスクの意図（退行に気づけること）は満たしている
- R2 の署名付きURL発行には、`env.BUCKET` の Workers バインディングとは別に、
  R2 の S3互換API を SigV4 で自前署名する必要がある（Cloudflare 公式の presigned URL の
  作り方）。軽量ライブラリ `aws4fetch` を使った（`apps/api/src/lib/r2-signed-url.ts`）。
  署名計算自体はネットワーク不要な純粋計算のため、テストは実際の R2 API トークン
  （`.dev.vars` の `R2_ACCOUNT_ID` 等）の設定有無に依存しないダミー値で行っている
- 署名付き PUT URL（クエリ文字列署名）自体には body サイズを制約する仕組みが無い
  （content-length-range を課せるのは presigned POST policy だが実装が重くなる）。
  そのため **サイズ上限（8MB）は `post.create` が `env.BUCKET.head()` で
  アップロード後に照合し、超過していれば R2 から削除して `INVALID_INPUT` にする**、
  という事後の防御線にした。クライアント側の圧縮（1600px/品質0.8）が正常系の主防御
- `imageId`（ULID）は `ulid` 等の外部パッケージを追加せず、`apps/api/src/lib/ulid.ts`
  に自前実装した。招待コード生成（`invite-code.ts`）と同じく `crypto.getRandomValues`
  を使い、文字集合を32文字にすることでバイト値の剰余に偏りが出ないようにしている
- `postSchema`（`packages/contract`）は `imageKey` を返さず `imageUrl`
  （署名付き GET URL）を返す形にした。`post.list` だけでなく `post.create` の
  レスポンスにも同じ `postSchema` を使っているため、`post.create` も画像があれば
  作成直後に GET URL を発行して返す（変更対象ファイルには `post.list` のみ
  挙がっていたが、型を1つに保つため両方に適用した）
- `apps/api/src/procedures/couple.ts` の `isConstraintViolation` を export に変更し、
  `post.ts` の image_key UNIQUE 制約違反判定でも再利用した（元々あった判定ロジックの再利用）
- `sign-in.tsx` の自前の二重発火ガード（`isSigningInRef`）は残してある。
  Button 標準のガードは「Promise が解決するまで無効化」だが、この画面は
  「signIn.social 成功後もページ遷移が始まるまで意図的に無効のままにする」
  という Button の標準機構では表現できない要件を持つため（コード内コメント参照）。
  二重ガードになるが実害はない
- **署名なしアクセスの拒否確認・実際のアップロード/削除の実機確認を実施した**
  （人間がR2 APIトークンを発行し`.dev.vars`に設定した後）。結果は
  `artifacts/007/manual-check.md`参照。要点:
  - `wrangler dev --remote`は、このCloudflareアカウントが`workers.dev`
    サブドメイン未登録のため実行できなかった（新しい`experimental_remote`設定も
    手元のwrangler 4.126.0/4.127.1では未対応で試せず）。そのため
    `env.BUCKET`（Workersバインディング）を実クラウドに向けての確認は
    今回できていない
  - 代わりに`r2-signed-url.ts`の署名生成ロジックを直接呼び出し、実クラウドR2
    （S3互換API）に対して確認した。**署名付きPUT成功→署名なしGETは
    `400 InvalidArgument: Authorization`で拒否→署名付きGETは成功しサイズが
    一致（54,321バイト）→期限切れ署名付きGETは`403 ExpiredRequest`で拒否→
    削除後は`404`**という一連の流れを確認できた。手続き
    （`post.uploadUrl`/`post.list`）が使う署名生成ロジックそのものを直接
    叩いているため、署名の正しさ・R2側の拒否挙動はこの確認で担保できる
  - **Rレビュー指摘を受けて追加確認**: 署名付きPUT URLはContent-Typeを
    署名で強制できない（`r2-signed-url.ts`のコメント参照）ため、
    `post.create`の`head.httpMetadata?.contentType`検証が機能するには
    「クライアントがヘッダを送る」「R2がそれを保持する」の両方が揃う必要がある。
    `apps/app/lib/image.ts`と同じ形（`headers: {"content-type": "image/jpeg"}`）
    でPUTし、署名付きGETのレスポンスヘッダで`content-type: image/jpeg`が
    返ることを確認し、両方揃っていることを実証した
  - **未確認のまま残るのは、`post.create`のR2実体確認（`env.BUCKET.head()`）と
    `post.delete`のR2バインディング経由削除（`env.BUCKET.delete()`）が
    実クラウドでも同様に動くこと。** これはMiniflareのローカルシミュレーション
    での単体テスト（`apps/api/test/post.test.ts`）でのみ検証済み。
    `workers.dev`サブドメイン登録後（016の前までに必要。`docs/state.md` L34）に
    `wrangler dev --remote`で再検証できる
