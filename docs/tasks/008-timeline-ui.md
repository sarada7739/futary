# 008: タイムラインUI

## 目的
ホーム画面に投稿一覧を表示し、投稿を作成できるようにする。
アプリとして初めて「使える」状態になるタスク。

## 前提（着手前に読む）

### 投稿者情報は `post.list` / `post.create` のレスポンスに含める

006 時点の投稿スキーマは `authorId` しか持っていない。投稿カードは投稿者の名前と
アバターを出すため、`authorName` / `authorImage` を**このタスクで契約に追加する**。
設計は `architecture.md` 5節「投稿のレスポンスに投稿者情報を含める」に従う。要点:

- `user` への **LEFT JOIN**
- `authorName` / `authorImage` はどちらも **null 許容**。null のときの代替表示を作る。
  **投稿本文は必ず読める状態を保つ**
- ただし `posts.author_id` は `user(id)` への外部キーを持つため、
  **「投稿者が引けない投稿」は現在のスキーマでは作れない。**
  代替表示は到達不能な備えであり、テストも書けない（`architecture.md` 5節）
- `authorImage` は Google のホストを指す外部URL。R2 の署名付きURLではない

`packages/contract` の変更なので、`apps/api` 側の結合テスト（`post.list` が
投稿者情報を返すこと）もこのタスクで書く。

### E2E は入れない

**Playwright はこのタスクで導入しない。** 007 で決めたとおり、
認証を伴う導線の自動化は重く、014 の未認証デモ経路で導入する
（`conventions.md` 6節に反映済み）。

このタスクで書くのは **画面結合テスト**（Vitest + React Native Testing Library、
oRPC クライアントをモック）である。007 で導入したテスト基盤の上に載せる。
モックする以上サーバとの契約は検証していない。そこは実機確認で見る。

## 変更対象ファイル
- （新規）`apps/app/app/(tabs)/index.tsx` — ホーム画面
- （新規）`apps/app/components/post-card.tsx`
- （新規）`apps/app/app/compose.tsx` — 投稿作成画面
- （新規）`apps/app/lib/query.ts` — TanStack Query の設定

## 実装内容
- ホーム画面に投稿一覧を表示する
  - 無限スクロール（`useInfiniteQuery`）で 006 のカーソルページングを使う
  - **統計カードと思い出しカードの置き場所を上部に空けておく**（012・013 で埋める）
- 投稿カード
  - 投稿者のアバターと名前、本文、画像、相対時刻（「3時間前」）
  - デザインサンプルの投稿カードを参考にする。白地・角丸20・極薄の影
  - 自分の投稿には削除メニューを出す
- **デザイン素材の適用**（`docs/sample/README.md` の割り当て表に従う）
  - ボトムタブ5つのアイコンを `透過素材/dnUunrHG.png` から切り出して差し替える。
    002 で絵文字1文字に代用した箇所を置き換える
  - FAB の「＋」も同素材に差し替える
  - ロゴを `透過素材/6sj6V6ve.png` の透過版に差し替える
    （現行は `sample.png` から彩度ベースで抜いたもの）
  - **原本はスプライトシートなので、切り出して表示サイズの3倍程度まで縮小する。**
    そのまま載せない
- 投稿作成画面
  - FAB から開く
  - テキスト入力と画像選択（1枚）
  - 送信中の状態を出す。二重送信を防ぐ
- ポーリング設定（ADR-008）
  - 画面が前面にある間、`post.list` を一定間隔で再取得する（例: 60秒）
  - 背景では停止する

## 状態の網羅
以下をすべて実装する。空状態を作り忘れると、初回起動時に真っ白な画面になる。

| 状態 | 表示 |
|---|---|
| 読み込み中 | スケルトンまたはスピナー |
| 投稿ゼロ | 「最初の思い出を残そう」といった案内と、投稿への導線 |
| 通信エラー | 再試行ボタン |
| 画像の読み込み失敗 | 代替表示（本文は読める状態を保つ） |

## 確認観点
- 空状態・エラー状態が実装されているか
- 無限スクロールで重複・欠落が起きないか
- スマホ幅とPC幅の両方でレイアウトが破綻しないか
- 生の16進カラーが混入していないか
- 二重送信が防げているか

## 完了条件
- [ ] 投稿一覧が表示され、無限スクロールが動く
- [ ] 投稿を作成できる（テキストのみ / 画像付き の両方）
- [ ] 自分の投稿を削除できる
- [ ] 4つの状態がすべて実装されている
- [ ] 画面結合テストが緑（最低3件: 一覧が描画される / 投稿作成後に一覧へ反映される / 投稿ゼロで空状態が出る）
- [ ] `post.list` が投稿者情報を返すことの結合テストが緑
- [ ] `artifacts/008/` にスクリーンショット（一覧・空状態・投稿作成、スマホ幅とPC幅）を保存。
      **実際に開発サーバを動かして撮る。**モックした画面のスクリーンショットで代替しない

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション

## 進捗
- [x] デザイン素材の切り出しと差し替え（タブアイコン・FAB・ロゴ）
- [x] TanStack Query 設定 + ポーリング
- [x] 投稿カード
- [x] ホーム画面（無限スクロール）
- [x] 投稿作成画面
- [x] 4状態の実装
- [x] 画面結合テスト
- [ ] 証跡保存（スクリーンショットは実機確認待ち） → `state.md` 更新 → `worklog.md` 追記

## 実装メモ（B）

- **契約変更（`authorName`/`authorImage`）とE2E方針の食い違いは、着手前にAへ報告し
  PR #44・#45で解決した。** 経緯は `docs/state.md` L35〜L37 参照。特にL37は
  `architecture.md` 5節の当初の理由付け（`author_id`はFKを持たない）が実際の
  スキーマと違うことをBの実測で発見し、Aが根拠を訂正したもの
- `apps/api/src/procedures/post.ts`: `post.list`は`user`への`LEFT JOIN`、
  `post.create`は`context.user`（`resolveCoupleContext`を通っても元の
  `RpcContext.user`はマージされて残っている）からそのまま埋める。後者は
  `context.user!`という非null表明を使っている（`mode:"member"`の時点で
  必ず非nullだが、`CoupleContext`の型が`user`とのつながりを表現できないため。
  `base.ts`冒頭コメントと同種の型システムの限界）
- **`packages/ui`にPNG画像アセットを初めて追加した際、`assets.ts`と同じ
  ベース名の`assets.d.ts`（`declare module "*.png"`）をtscが読み込まない
  事象に遭遇した。** TypeScriptは同じディレクトリに`foo.ts`と`foo.d.ts`が
  並ぶと後者を前者の宣言スロットとして扱い、独立したグローバル環境宣言としては
  コンパイル対象に含めない。ベース名を`png.d.ts`に変えて解決した
- タブアイコン・FAB・ロゴは`docs/sample/透過素材/`のスプライトシートを
  Pillow（`python -m pip install pillow`で導入済みの環境）でalphaチャンネルの
  空白を検出して自動分割するスクリプトを一時的に書いて切り出した
  （`docs/sample/README.md`の指示どおり原本は加工せず、切り出し先だけを
  `packages/ui/assets/`に残し、スクリプト自体は使い捨てなので削除済み）。
  タブアイコンは単色の線画のため色を変えず、`Image`の`tintColor`で
  アクティブ/非アクティブを塗り分ける方式にした（`docs/sample/README.md`の
  「単色のものはtintColorで着色できる形に加工する」を採用）。FABの円+プラスは
  2色（円のピンク+白のプラス）のため`tintColor`が使えず、円のピクセルだけを
  トークンの`primary`（`#F5868D`）に寄せて再着色した（素材の色が実測で
  `(254,123,128)`とトークンからわずかにずれていたため）
- FABは`packages/ui`の`Button`ではなく`(tabs)/_layout.tsx`内の専用コンポーネント
  のままにした（タブバー内の特殊な配置・浮き出し〈`marginTop:-20`〉が
  `Button`の責務と合わないため）。ただし押下時の見た目のフィードバックは
  影の下に沈める形ではなく`opacity`に変更した（画像アセット自体が円を
  含むため、背景色を変える方式が使えなくなったため）
- FABタップで投稿作成画面を開く実装は、タブ自体を切り替えず
  `Tabs.Screen`の`listeners.tabPress`で`e.preventDefault()`した上で
  `router.push("/compose")`する形にした（React Navigationの定番パターン）。
  `(tabs)/post.tsx`のプレースホルダー画面はこのリスナーで常に遷移が
  打ち消されるため実際には表示されない。削除せず残してある（ファイルベース
  ルーティング上`Tabs.Screen name="post"`に対応するファイルが必要なため）
- `compose.tsx`はタブ配下ではなく`app/_layout.tsx`のルートStackに
  `presentation: "modal"`で追加した。`hasCouple`のガード配下（`(tabs)`と同じ
  `Stack.Protected`）に置き、ペア未成立では開けない
- 投稿カードの削除は「…」を押すと確認用の「キャンセル」「削除」ボタンが
  現れる形にした（誤タップでの削除を防ぐ）。「削除」自体は`packages/ui`の
  `Button`を通すことで二重発火防止の恩恵をそのまま受ける
- ホーム画面の無限スクロール・pull-to-refresh・ポーリング（60秒）は
  `useInfiniteQuery`の`refetchInterval`と`lib/query.ts`の`focusManager`
  配線（ネイティブは`AppState`、Webはブラウザ標準のvisibilitychangeに
  TanStack Queryが対応済み）の組み合わせで実現した。既定の
  `refetchIntervalInBackground: false`により背景では自動的に止まる
- 画面結合テスト（`test/home-timeline.test.tsx`）は、oRPCの生クライアント
  （`client`）だけをモックし、`createTanstackQueryUtils`は本物を使う方式にした。
  `queryOptions`/`infiniteOptions`/`mutationOptions`の実装自体はモックしないため、
  TanStack Queryの実際のキャッシュ・無効化・再取得の挙動を検証できる。
  `expo-router`・`expo-image-picker`・`expo-image-manipulator`は、
  Vitest（jsdom）環境で`__DEV__`未定義によりクラッシュするため最小スタブに
  差し替えている（`expo-image-manipulator`は`image.test.ts`と同じ形）
- **`artifacts/008/`のスクリーンショットは実機確認待ち。** タイムライン・
  投稿作成画面はGoogleログイン+ペア成立済みでないと表示できず、
  デモ未認証モード（`DEMO_COUPLE_ID`）は014まで空文字のためこの段階では
  代替にならない。人間にログインを依頼し、確認後に追記する
