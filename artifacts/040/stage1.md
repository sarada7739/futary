# 040 段階1: ほしいもの — 実装の報告

2026-09-13 / セッションB。A の「段階0の決定」（タスク定義末尾）と `security-requirements.md` 6節に従って実装した。

## 守りたいことの一文（A）に対して、どこで守っているか

> 利用者の URL を fetch する経路は `want.create` の 1 本だけで、6節の条件（scheme・ホスト・リダイレクト・1MB・12 秒・画像の型と 1MB・Cookie 無し・拾う属性の列挙）を全部その 1 本が通り、失敗しても保存は成功する。書けるのは本人だけで、`couple_id` の外には触れない。

| 守りたいこと | 場所 | テスト |
|---|---|---|
| fetch する経路は 1 本 | `apps/api/src/lib/link-preview.ts` の `fetchLinkPreview` だけが外へ出る。呼ぶのは `procedures/want.ts` の `want.create` だけ（`url` があり、画像か題名が無いとき） | `want.test.ts`「手で付けた画像と題名の両方があれば、外へ一切行かない」 |
| scheme | 契約 `urlInputSchema`（`isHttpUrl`。BAD_REQUEST）+ `isFetchableUrl`（二重） | `want.test.ts` T1、`link-preview.test.ts` isFetchableUrl |
| ホスト（IP リテラル・localhost・.local・.internal） | `isFetchableHost`。fetch の前に検査し、**リダイレクト先も同じ検査** | `link-preview.test.ts` T1・リダイレクト先が内部 |
| リダイレクト 3 回 | `redirect: "manual"` で 1 段ずつ辿る。4 回目は辿らない | `link-preview.test.ts` リダイレクト 3 件 |
| ページ 1MB・全体 12 秒 | `readUpTo(PAGE_BYTE_LIMIT)`・1 つの `AbortController` をページと画像で共有 | `link-preview.test.ts`「先頭 1MB で打ち切る」「12 秒を超えたら中断」 |
| 画像の型と 1MB | `Content-Type` の許可リスト（jpeg/png/webp）と**先頭バイト**の両方。1MB 超は画像無し | `link-preview.test.ts` 画像の制限 6 件 |
| Cookie・認証ヘッダ無し・UA は futary | ヘッダはここで並べたものだけ | `link-preview.test.ts`「Cookie・認証ヘッダを送らず、User-Agent は futary を名乗る」 |
| 拾う属性の列挙 | `extractMeta`: `og:title` `og:image` `twitter:image` `<meta name="title">`、**Amazon のホストに限り** `data-old-hires`（無ければ `data-a-dynamic-image` の先頭） | `link-preview.test.ts` T2（本物の HTML 5 本 + 壊れた HTML） |
| 失敗しても保存は成功 | `fetchLinkPreview` は例外を投げない。理由は `failures` に積み、`want.create` が `console.warn` に 1 行（status・本文先頭 200 文字。URL・キーは書かない） | `want.test.ts` T3 |
| 書けるのは本人だけ | update / setImage / setObtained / delete の WHERE に `owner_id = ctx.userId`。他人の id は存在しない id と同じ NOT_FOUND | `want.test.ts` T4 |
| `couple_id` の外に触れない | 全クエリに `couple_id = ctx.coupleId`。list は `readProcedure`、書き込みは `writeProcedure` | `want.test.ts` T5、`authorization.test.ts`（手続き列挙・ゲスト FORBIDDEN・未所属 NEEDS_ONBOARDING） |

## T1〜T11

| # | 結果 | 場所 |
|---|---|---|
| T1 | 緑 | `link-preview.test.ts`（fetch を差し替えて呼ばれないことを見る）、`want.test.ts` |
| T2 | 緑 | `link-preview.test.ts`。フィクスチャは `apps/api/test/fixtures/link-preview/`（段階0の本物の HTML 5 本 + 手で作った壊れた HTML）。**「1MB なら取れる」**は `amazon-B07T35N29H-head512k.html`（画像ブロックが 512KB の外にあった応答の先頭 512KB）の後ろに実物の `<img id="landingImage">` を 620KB の位置に継ぎ足して固定した（先頭 512KB では取れないことも同じテストで見る） |
| T3 | 緑 | `link-preview.test.ts`（1MB 超・許可外の型・先頭バイト不一致・4 回目のリダイレクト・12 秒超・ページ 520）、`want.test.ts`（失敗しても `create` が 200） |
| T4 | 緑 | `want.test.ts`「本人以外は触れない」 |
| T5 | 緑 | `want.test.ts`「couple_id スコープ」 |
| T6 | 緑 | `want.test.ts`「上限 100 件」（手に入れた分は数える・削除した分は数えない・相手は別枠） |
| T7 | 緑 | `me.test.ts`（既存の me.delete テストに wants の行と `wants/` の R2 オブジェクトを足した。機械的走査のテストも wants を拾う） |
| T8 | 緑 | `want.test.ts`「Amazon の URL の正規化」 |
| T9 | 緑 | `viewer-key-coverage.test.ts` が `want.tsx` の 2 つの `useQuery` を自動で拾う。**拾っていることを確かめた**: viewerKey を外すと `want.tsx:304 の useQuery(...): viewerKeyが確認できません`（status `exact-missing`）で赤になり、戻すと緑（`t9-red.txt` 相当。下記） |
| T10 | 緑 | `want-screen.test.tsx`（初期タブが相手・+ は自分のタブだけ・1 人のペアはタブ無し・ゲストは + が無い・相手の行にメニュー無し・URL を押すと `Linking.openURL`・追加の呼び出し） |
| T11 | 緑 | 契約 `urlOutputSchema` は `isHttpUrl` を通す。`want.test.ts`「DB に javascript: の URL が入っていても list は返さず落ちる」 |

T9 で赤になったときの出力:

```
× 要求される条件を満たさず、免除もされていない呼び出しは0件である
AssertionError: apps\app\app\(tabs)\want.tsx:304:24 の useQuery(...): viewerKeyが確認できません
+ "status": "exact-missing",
```

`pnpm -r test`: api 549 / app 364 / db 30 / ui 16 / date 61、すべて緑。`pnpm run type-check`・`pnpm run lint` 緑。

## 作ったもの

- `packages/db`: `wants` 表（`0021_wants.sql`。index `(couple_id, owner_id, created_at)` と `image_key` の UNIQUE）。デモシードに各 2 件（画像は 1 件。`seed/assets/want-mug.jpg`）
- `packages/contract`: `want.*` 7 手続き。`Want.url` は入力・出力とも http/https のみ
- `apps/api`: `lib/link-preview.ts`（外部 fetch の 1 本）、`lib/want-url.ts`（Amazon の正規化）、`procedures/want.ts`、`me.delete` に `wants` の行と `wants/` の接頭辞削除
- `apps/app`: `(tabs)/want.tsx`、ホームを 3 列 × 3 行に、「リスト」の隣に「ほしいもの」
- `packages/ui`: `panel-want.png`（ピンクの線画。ハート）、`panel-white-want.jpg`（ホワイトの写真タイル）。出自は `docs/sample/README.md`

## B が決めたこと（A に見てほしい）

1. **一覧のカードで題名を 3 行・メモを 2 行で省略する。**Amazon の題名は整形後も 100 文字近く、2 列のカードが縦に伸びた（`white-want-me-after-live-add.png` の初回撮影で確認）。全文は編集フォームで見える
2. **ゲスト（デモ閲覧）は partner = slot 1・me = slot 2 の人に当てる**（`isMine` は常に false）。「me は居ない」にするとデモで 1 人分しか見えず、シードに各 2 件入れた意味が無い。書けないのは `writeProcedure` が守る
3. **IP リテラル・localhost の URL は「保存を拒む」のではなく「取りに行かない」**（画像無し・題名はホスト名で保存される）。6節の条文が「取りに行かない」なのでそのとおりにした。scheme は入力で弾く（BAD_REQUEST）
4. **手で付けた画像があるときは題名だけ取り、画像は取りに行かない**（`needImage: false`）。既に持っているものを外から取り直さない
5. ~~画像が無い行のしるしは 🔗 の文字~~ → **A の指示で撤回**（2026-09-13）。絵文字はカラーで描かれ、ホワイトで浮く（`white-want-me.png` の初回撮影）。
   画像が無い行は `surface-tint` の四角だけにした。タスク定義 5節「リンクのアイコン」は A が撤回し文書側を直す
6. `want.list` の `ownerName` が null なら「そちら側の人が居ない」（1 人のペアの partner・ログイン前の me）。画面はこれでタブを出すかを決める

## 動作証跡（`artifacts/040/stage1/`）

ローカル（`wrangler dev` + expo web）。ログイン状態は `scripts/make-session.mjs` がローカル D1 に作ったペア（ゆう・さき）とセッション Cookie で再現した（Cookie の値は artifacts に置いていない）。

| ファイル | 何を |
|---|---|
| `{pink,white}-home.png` / `-home-pc.png` | ホームの 3 列 × 3 行（iPhone 幅・PC 幅）。「リスト」の隣に「ほしいもの」 |
| `{pink,white}-want-partner.png` / `-pc.png` | 初期タブ（相手）。画像あり・URL だけ・手に入れた（末尾・muted・バッジ） |
| `{pink,white}-want-me.png` | 自分のタブ。+ 追加と … メニュー |
| `{pink,white}-want-add.png` | 追加モーダル（URL・題名・メモ・画像を選ぶ） |
| `white-want-me-after-live-add.png` | **人間の Amazon URL を実際に保存した直後**（下記） |
| `{pink,white}-want-guest.png` / `-guest-me-tab.png` | ゲスト: 2 人分（ゆい・れん）のタブ。+ は無く、ログイン導線だけ |
| `capture.json` | ライブ保存の計測とコンソールエラー |

**ライブ保存**（`https://www.amazon.co.jp/dp/B0HJBHHXK2/`。ローカルの wrangler dev から。**PC の IP から出るので本番の証明ではない**）:
「画像を取得中…」の表示あり・2.4 秒で閉じた・「画像は取れませんでした」は出ていない。ローカル D1 の行:
`url = https://www.amazon.co.jp/dp/B0HJBHHXK2`（tag・末尾の / が落ちた）、`title = Apple iPhone 18 Pro Max (2 TB) - グレイシャー | …一日中使`（100 文字。前置き・後置き無し）、
`image_key = couples/shot-couple/wants/01M…TF.jpg`。ローカル R2 の実体: **JPEG 1500×1500・66,255 バイト**（段階0で測った Amazon の画像と同じ大きさ）。

**画面上で画像の枠が空に見える理由**: ローカルの署名付き GET URL は本物の R2（`<accountId>.r2.cloudflarestorage.com`）を指し、ローカル R2 に置いた実体は届かない（`capture.json` の 404 はそれ。投稿画像もローカルでは同じ）。本番では署名付き URL が実体を指す。**人間の実機確認（完了条件）で画像が見えることを確かめてほしい。**

## 確認観点との対応

| 観点 | |
|---|---|
| 人間が貼った Amazon の URL で、本番で画像が付く | ローカルからは付いた（上記）。**本番はデプロイ後に人間が確認** |
| 相手のタブが最初に開く。自分のタブでだけ足せる | `pink-want-partner.png` → `pink-want-me.png`。T10 |
| 相手の行を長押ししても何も出ない | 相手の行には `onLongPress` も … も無い（`want.tsx` の `onOpenMenu` は `isMine` のときだけ）。T10 |
| 画像が取れなかった行に、あとから写真を付けられる | … → 「画像を付ける」→ `want.uploadUrl` → PUT → `want.setImage`。サーバ側は `want.test.ts` setImage 3 件。**画面からの一連は実機で**（Playwright でファイル選択まではしていない） |
| 退会で消える | T7 |
| ホームの 3 列がピンク・ホワイトの両方で崩れない（iPhone 幅・PC 幅） | `*-home.png` / `*-home-pc.png` |

## やっていないこと・残るもの

- **本番での Amazon の画像付与**（完了条件）は人間の手番。デプロイ後に 1 本貼って確かめる
- `security-requirements.md` 6節・`architecture.md` 5節の記述と実装は一致している（B が読み合わせた）。設計文書は変えていない
- ホームのピンクは 4 列 → 3 列でタイルが大きくなった（A の判断どおり。039 の凍結の範囲外）
