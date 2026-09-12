# 039 段階1: ホワイトモード — 基盤 + パレット + 切り替え

**タスク定義5節の停止条件どおり、ここで止める。**段階2（モック固有の形）には進んでいない。

## 1. 作ったもの

| 場所 | 変更 |
|---|---|
| `packages/ui/src/theme.ts`（新規） | `Appearance`（`"pink" \| "white"`）、`Colors` / `Shadow` / `Gradients` の型、両モードの値（`themes`）。**`themes` は `@futary/ui` から export しない**（出すと `themes.pink.colors` で静的に取れて留め金が消える） |
| `packages/ui/src/appearance.tsx`（新規） | `AppearanceProvider` / `useAppearance()` / `useTheme()`。保存先は `window.localStorage` の `futary.appearance`（ADR-014）。Provider が無ければ pink |
| `packages/ui/src/tokens.ts` | `colors` `shadow` `gradients` を**削除**（留め金）。`radius` `space` `layout` `fontFamily` は残す |
| `packages/ui/src/components/*` | `Screen` `Card` `Button` `Text` `Avatar` を `useTheme()` に。`Card` はホワイトのときだけ `border` 1px。`Screen` はホワイトではボケを敷かない |
| `packages/ui/src/components/fab.tsx`（新規） | `FabIcon`。ピンクは従来の画像（`fab-plus.png`）そのまま、ホワイトは黒い円 + 白い＋（下記 4節） |
| `apps/app`（21ファイル） | 型チェックが挙げた場所を全部 `useTheme()` に。モジュール直下の定数だった3箇所（`list.tsx` の入力欄スタイル・`mood-month-grid.tsx` の primary の RGB・`event-kind.ts` の種別色）は描画時に組み立てる関数にした |
| `apps/app/app/(tabs)/profile.tsx` | 「見た目」カード（ピンク / ホワイト。押した瞬間に全画面が変わる。保存ボタン無し。ゲストにも出す。「この端末だけの設定です。相手には反映されません」） |
| `apps/app/app/_layout.tsx` | ルートに `AppearanceProvider` |
| `apps/app/app/+html.tsx` | inline script 1本と `<style>` 1つ（下記 5節。**測ってから足した**） |
| `scripts/build-public.mjs` | inline script を全部集めて、それぞれの sha256 を `script-src` に並べる（本数は `EXPECTED_INLINE_SCRIPT_COUNT` = 2 で固定。増えたらビルドが止まる） |

**入れた依存: 無し。**`eslint.config.js` の ignores に `artifacts/**` を足した（証跡の再現用スクリプト `artifacts/039/scripts/*.mjs` を lint 対象にしない）。`apps/app/test/react-dom-server.d.ts` は型宣言のみ（`react-dom/server` の `renderToString` を hydrate の検査で使うため。`@types/react-dom` は入れていない）。

## 2. テスト（タスク定義8節）

| # | どこ | 何を |
|---|---|---|
| T1 | `packages/ui/test/theme.test.ts` | ピンクの `colors` `shadow` `gradients` が、テスト内に手で凍結した 038 時点の写しと完全一致 |
| T2 | 同上 | 両モードのキー集合が同一（`Object.keys`）。`themes` のキーが `APPEARANCE_VALUES` と一致 |
| T3 | `apps/app/test/appearance.test.tsx` | 既定 pink。`localStorage` が white なら white。未知の値 5種は pink。`setAppearance` が state と `localStorage` の両方を更新。切り替えで `useTheme()` が即座に変わる。`<meta theme-color>` の書き換え。**pink で描いた SSR HTML を hydrate しても不一致にならず、直後に white になる**（`renderToString` の本物の出力で検査。`+html.tsx` が付ける属性が外れることも見る） |
| T4 | 同上 | Provider 無しで `useTheme()` が pink。`localStorage` に white があっても Provider 無しなら pink |
| T5 | 同上 | `Screen` のボケ: pink で描く・white で描かない・Provider 無しで描く |
| T6 | `apps/app/test/profile-screen.test.tsx` | 「ホワイト」を押すと `useAppearance().appearance` が white・`localStorage` に保存。ゲストでもカードが出て切り替えられる。並び順（プロフィール → 見た目 → 記念日） |
| T7 | `apps/app/test/ui-token-import.test.ts` | `apps/app` 配下（test を除く）に `@futary/ui` から `colors` / `shadow` / `gradients` を import する行が無い（TypeScript の AST で import 指定子を走査。別名・名前空間 import・re-export も検出）。反対側: `packages/ui/src/index.ts` の export 指定子と `tokens.ts` の宣言に禁止名が無い |
| 追加 | `apps/app/test/appearance.test.tsx` | `FabIcon`（pink は画像・white は黒い円）。`+html.tsx` の inline script の文面が `APPEARANCE_STORAGE_KEY` / `APPEARANCE_HTML_ATTRIBUTE` と一致し、外部 URL を含まない |

T3〜T5 を `packages/ui` ではなく `apps/app/test` に置いた理由: `packages/ui` に jsdom・testing-library・react-native-web が無く、足すと「入れる依存: 無し」に反する（A 了解済み。タスク定義「B との合意」）。

`pnpm -r test`（apps/app 332件・packages/ui 16件・apps/api 457件）・`pnpm -r type-check`・`pnpm -w lint`、全て緑。

## 3. B が決めた値と理由（A が `architecture.md` 7節へ写す）

### 色（ホワイト）

| トークン | 値 | 理由 |
|---|---|---|
| `bg` | `#FFFFFF` | 真っ白（A の参考値どおり） |
| `surface` | `#FFFFFF` | 地と同じ。カードは影ではなく枠線で浮く |
| `surface-tint` | `#F5F5F7` | apple.com の背景セクション・iOS 設定のグループ地の値。押下時・写真タイルの地 |
| `primary` | `#1D1D1F` | Apple の文字色。純黒 `#000000` は白地の上でコントラストが強すぎて硬い |
| `primary-pressed` | `#3A3A3C` | 黒を「少し持ち上げる」。iOS の systemGray5 系の暗い側 |
| `primary-subtle` | `#F5F5F7` | `surface-tint` と同値（役割が違う。ピンクでは値が違う） |
| `brand-ink` | `#1D1D1F` | 見出しも黒。ホワイトに「ブランドの茶色」に相当する色は無い |
| `text` | `#1D1D1F` | |
| `text-muted` | `#86868B` | Apple の副次テキスト色。白地でコントラスト比 3.5:1 |
| **`border`** | **`#D2D2D7`** | **A の参考値 `#E5E5EA` より濃くした。**ホワイトでは枠線が唯一の輪郭で、035 で `border` が薄すぎた教訓がある。`#D2D2D7` は apple.com のヘアラインの値で、iOS の separator（`#C6C6C8` 相当）と `#E5E5EA` の中間。1px でも確実に見える。スクリーンショット（`dev/white-*.png`）で確認した。**人間が薄い / 濃いと感じたら変える**（`theme.ts` の1箇所） |
| `overlay` `event-*` `danger` | ピンクと同じ | 機能色。テストで固定 |

### 影・発光・グラデーション（ホワイト）

| トークン | 値 | 理由 |
|---|---|---|
| `shadow.card` | 不透明度 0 | 無し。代わりに `Card` が `border` 1px |
| `shadow.fab` | 0.18 / 10 / y4（ピンクは 0.15 / 6 / y3） | 黒い円は輪郭が強く、狭い影だと「貼ったシール」に見える。広めの薄い影で地から離す |
| `shadow.glow` | 不透明度 0 | 発光はピンクの語彙 |
| `gradients.screen` | `#FFFFFF` → `#FFFFFF` | 平ら。両端を同じ色にして `LinearGradient` を「ただの塗り」にする（部品側で分岐しない） |
| `gradients.card` | `#FFFFFF` → `#FFFFFF` | 同上 |
| `Screen` のボケ | 敷かない | 画像の有無なので `appearance` で分岐（タスク定義3節どおり、分岐はここだけ） |

「無し」は不透明度 0 で表した（値で表せるものは値で表す）。

### `Card` の枠線

**ピンクには足さず、ホワイトのときだけ 1px**（`Card` 内で分岐。A 了解済み）。ピンクに足すと中身が 1px 内側へ動く。

## 4. FAB（中央の投稿ボタン）

A の想定（タスク定義 5-2 d「FAB は黒。3節で値が変わる」）と違い、**FAB は色トークンではなく PNG（`fab-plus.png`: ピンクの円に白い＋）だった。**ホワイトの画面でピンクの円が残るので段階1で対処した。

- 画像の画素を実測: 白 1840px・ピンク 19930px・透過 6014px。**＋は透過ではなく白の塗り**なので、`tintColor` で黒くすると＋まで黒く塗りつぶされて消える
- `packages/ui/src/components/fab.tsx` の `FabIcon` を作った。**ピンクは従来の `<Image>` をそのまま返す**（画素比較で 0 差。下記 7節）。ホワイトは `primary` の円（`View`）+ `surface` の＋（`View` 2本。腕 22 / 太さ 2.5 at 56pt。画像の＋とほぼ同じ比率）
- 分岐は部品の中。`(tabs)/_layout.tsx` は `appearance` を読まない

### ボトムタブの枠線（人間の指摘で段階1に前倒し）

段階1の最初のスクリーンショットを見た人間から「ホワイトのボトムタブの境目が見づらい。濃さか影を
少し変えてほしい」と指摘があった。ホワイトでは `shadow.card` が不透明度 0 なので、白いピルが白い地に
溶けていた。モック・タスク定義 5-2 d のとおり **ホワイトのときだけ `border` 1px（`#D2D2D7`）** を
タブバーに付けた（`(tabs)/_layout.tsx`。ピンクには足さない。画素比較 7節で 0 差のまま）。
影ではなく枠線にしたのはモックが枠線だから（影は `shadow.card` の値を変えれば1箇所で戻せる。
**枠線より影の方が好みならそう言ってほしい**）。

## 5. 起動時の一瞬（`+html.tsx` の inline script。A の指示「測ってから決める」）

### 測った

`web.output: "static"` で prerender された HTML（`apps/api/public/app/(tabs)/index.html` 等）には
**ピンクの地（`rgba(254,246,243,1.00)`）・ボケ画像・`読み込み中…` が入っている。**クライアントは
`__EXPO_ROUTER_HYDRATE__=true` で hydrate する（B が書き出した HTML で確認）。

本番相当（`build-public.mjs` → `wrangler dev` が配信）に対して、Playwright（Chrome、390×844、
`localStorage` に white を入れた状態）で `requestAnimationFrame` ごとに `#root` の地の色を見て測った
（`artifacts/039/prerender/prerender-flash-measurement.json`。各3回）:

| 通信条件 | inline script **前**: ピンクが見える時間 | inline script **後** |
|---|---|---|
| 無制限（localhost） | 106〜121 ms | **0**（ピンクのフレーム無し） |
| 4G 相当 | 1035〜1054 ms | **0** |
| 低速 3G 相当 | 7981〜8058 ms | **0** |

**見える**（localhost でも1フレーム以上、実際の回線では1秒〜8秒）。したがって A の判断どおり inline script を足した。

### 足したもの

- `+html.tsx` の `<head>` に静的な inline script 1本: `localStorage` の `futary.appearance` が `"white"` なら `<html data-appearance="white">` を付ける。利用者の入力・外部 URL を含まない（テストで固定）
- 同じく静的な `<style>`: `html[data-appearance="white"] #root{visibility:hidden}`。JS が届くまで `#root`（ピンクの prerender）を隠す。body の地は白なので、**白の空白**が見える（`prerender/prerender-before-js-white-user.png`）
- `AppearanceProvider` がホワイトで描き終えた commit の後に属性を外す（`useLayoutEffect`。paint 前）
- `scripts/build-public.mjs` が inline script を全部集めて sha256 を並べる。`script-src 'self' 'sha256-…' 'sha256-…'`。**`'unsafe-inline'` にはしていない。**本数は 2 で固定し、増えるとビルドが止まる（意図しない inline script が静かに許可されない）

### hydrate の不一致について（B が見つけた）

prerender は pink、クライアントの最初の描画が white だと React の hydrate が不一致になり、**本番では属性（style）の差を直さない**（サーバの pink がそのまま残る）。そのため Provider の**最初の描画は必ず pink（サーバと同じ）**にし、`useLayoutEffect` で保存値へ切り替える（paint 前に同期で再描画される）。T3 が本物の `renderToString` 出力を hydrate して不一致が無いことを検査する。

ピンクの利用者には何も変わらない（属性が付かない。`#root` を隠さない。prerender の見え方もそのまま）。

## 6. 写真アセット（人間へ。段階2で使う）

| 用途 | 枚数 | 形 | 備考 |
|---|---|---|---|
| 機能パネルの写真タイル（5-c） | **8** | **正方形。長辺 600px** | 順にタイムライン・カレンダー・思い出・統計・今日どうだった？・リスト・気分の記録・AIまとめ。表示は最大 160 CSS px × 2倍 = 320px なので 600 で足りる。角は B が `radius.input`(14) で丸める（原本は角丸にしない） |
| 統計のヒーロー（5-f） | **1** | **横長 4:3（1280×960px）** | `layout.maxWidth` 640 × 2倍 = 1280。モックのヒーローは幅いっぱいでほぼ 4:3 |
| ホームのロゴ | 0 | 要らない | 文字で描く（Poppins 300） |

上げる先は `docs/sample/simpleMode/`。原本は加工しない。B が切り出して `packages/ui/assets/` に置く。
差し替え口は `packages/ui/src/assets.ts` の1箇所（段階2で作る）。

## 7. ピンクが変わっていないこと（画素比較）

main（`81a6c7b`）を別の worktree で起動し、同じデモデータ・同じ Playwright（390×844、2倍）で撮った
（`artifacts/039/baseline-main/`）ものと、このブランチ（`artifacts/039/dev/pink-*.png`）を画素で比較した
（`artifacts/039/pink-pixel-diff.json`。`scripts/pixel-diff.mjs`）。Expo の開発用フローティングボタン
（`#root` の外）は両方で隠した。

| 画面 | 差のある画素 / 全画素 |
|---|---|
| ホーム | **0 / 1,316,640** |
| タイムライン | **0 / 1,316,640** |
| 統計 | **0 / 1,316,640** |
| マイページ（ゲスト） | 差は y=106〜1105（device px）の範囲だけ = 「見た目」カード + そのぶん下へ寄ったログイン案内（設計どおり）。**デモバナー（上）とタブバー（下）は 0 差**（`pink-profile-shift-diff.json`）。案内ブロックの余白・折り返しは 014 のまま。地がグラデーション + ボケなので、位置が変わった行は画素では一致しない |

T1（値の凍結）と合わせて、ピンクの値・部品の描画・FAB の画像が変わっていないことを示している。

## 8. ホワイトで全画面にピンクが残っていないこと

`artifacts/039/dev/scan.json`。DOM の全要素の computed style（`color` `backgroundColor` `border*Color`
`boxShadow` `backgroundImage` 等）に `#F5868D` `#7B4A3C` `#FEF6F3` が含まれないことを見た（036 と同じ道具）。

| 画面 | ピンクの要素 / 全要素（ホワイト） |
|---|---|
| サインイン（リロード直後） | 0 / 57 |
| ホーム | 0 / 298 |
| タイムライン | 0 / 604 |
| 統計 | 0 / 636 |
| マイページ（ゲスト） | 0 / 658 |
| カレンダー | 0 / 817 |
| 思い出 | 0 / 842 |
| リスト | 0 / 911 |
| 気分の記録 | 0 / 1,121 |
| AIまとめ | 0 / 1,159 |

**見ていない4画面**: 投稿（compose）・参加（join）・アカウント削除・画像ビューア / イベントフォーム（モーダル）。ゲストでは開けない（ログインが要る）か、操作が要る。型チェック + T7 で `useTheme()` に置き換わっていることは保証されている。人間の実機確認（ログイン後）で見てほしい。

同じ走査で、ピンクのときは各画面に 19〜32 要素のピンクがある（走査自体が効いている証拠）。

## 9. 確認観点（タスク定義）との対応

| 観点 | 結果 |
|---|---|
| ピンクが変わっていない | T1 緑 + 画素比較 0 差（7節） |
| ホワイトで全14画面にピンクが無い | 10画面で 0（8節）。4画面は未確認（理由同上） |
| 切り替えた直後に全画面が変わる | マイページで押した瞬間に変わる（`dev/white-profile-just-switched.png`）。T3 で `useTheme()` が即座に変わることを検査 |
| リロードしてもホワイトのまま。一瞬もピンクにならない | `dev/white-sign-in-after-reload.png`。本番相当で 0 フレーム（5節） |
| `localStorage` を消すとピンクに戻る | `dev/pink-sign-in-after-clear.png`（ピンク 12 要素） |
| ゲストでマイページを開いて切り替えられる | T6 + `dev/white-profile.png` |

## 10. やらなかったこと・決めたこと

- **段階2（a〜h）には進んでいない**（停止条件）
- **`Card` の 1px をピンクに足さない**（分岐。A 了解済み）
- **`themes` を export しない**（留め金を守る）
- **ネイティブ（iOS）はメモリだけ**（`Platform.OS !== "web"`）。保存しない。インターフェースは同じ
- **同じ端末の別ブラウザ・別端末では別々の設定になる**（`localStorage` なので）。それでよい（ADR-014）
- `expo-secure-store` を使わない（秘密ではない）
- **`apps/landing/style.css` は触っていない**（ランディングはピンクのまま。ホワイトは Web アプリの設定）
- **`+html.tsx` の inline script は測ってから足した**（5節）。測る前に足していない

## 11. 見つけたこと（B の報告）

- **Node 25 の global `localStorage`**: `--localstorage-file` 無しではメソッドを持たない空のオブジェクトで、vitest の jsdom 環境でも Node のものが勝つ（`clear is not a function`）。`packages/ui` は `window.localStorage` と明示し、`apps/app/test/setup.ts` がメソッドの無いときだけ in-memory の Storage を補う
- **`pnpm -r type-check` が挙げた直し忘れは 21 ファイル + `packages/ui` のテスト1本**（A の見立てどおり。停止条件「21 より広がった」には当たらない）
- **開発サーバ（expo web）では Poppins のフォントが 404**（`/app/fonts/…`。main でも同じ）。本番ビルドでは出ない。今回の範囲外
