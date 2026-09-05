# 035: サインイン個別の作り込み・残り12画面の通し確認

Aの許可（800採用の連絡と同時）を受けて、タスク定義4節（サインイン画面）と
残り12画面の通し確認を行った。

## サインイン画面（タスク定義4節）

- **中央に大きなロゴ**: ホーム上部で使っている`logoMark`（既存のブランド
  ロゴ画像。新しいフォント・新しい画像は追加していない）を、ホームの
  96×34より大きい224×79で出すよう`sign-in.tsx`を変更した
  （元画像は168×59でラスターのため、これ以上の拡大は粗さが目立つと判断）
- タグライン2行・ボタン3つ（primary/secondary/ghost）は既に035書体仕様・
  視覚仕様の対応で実装済みだったため変更なし
- `screens/01-sign-in.png`（スマホ幅）・`01-sign-in-desktop.png`（PC幅）
  で確認

## 残り12画面の通し確認

**部品（`Screen`・`Card`・`Button`・`Badge`・`Avatar`・`FeaturePanel`・
タブバー）は全画面が既に経由している**ことをコードで確認済み
（各画面の`import`に`@futary/ui`からの部品が並んでいる）。個別の細工は
足していない。

### 発見した不具合: タブバーを浮かせた分の下パディングが8画面で未対応

タスク定義2節「浮かせると、下のコンテンツが隠れる。各画面のスクロールの
下パディングを、タブバーの高さ＋余白ぶん足すこと」の対応が、
`(tabs)/index.tsx`（ホーム）にしか入っていなかった。残り8画面
（`calendar.tsx`・`timeline.tsx`・`memory.tsx`・`stats.tsx`・`list.tsx`・
`mood.tsx`・`profile.tsx`・`delete-account.tsx`）は`padding: space.lg`
（16px）のみで、`TAB_BAR_CLEARANCE`（64+16+8=88px）を含んでいなかった。

`(tabs)`ナビゲータの`tabBarStyle`は`href: null`のスクリーン（memory・
stats・list・mood・delete-account）にも適用される（タブの項目としては
出ないが、タブバー自体は浮いたまま画面に重なる）ため、これらも含めて
全8ファイルの`contentContainerStyle`に`paddingBottom: TAB_BAR_CLEARANCE`
を追加した。

**実測で確認**: タイムライン（`FlatList`、無限スクロール）とリスト
（`ScrollView`）で、実際にスクロール可能な要素の`scrollTop`を
`scrollHeight`まで動かし（`document.querySelectorAll`で`overflow-y:
auto/scroll`かつ`scrollHeight > clientHeight`の要素を検出）、
最後の項目がタブバーに隠れずに見えることを確認した
（`screens/04-timeline-bottom.png`・`screens/07-list-bottom.png`）。
気分の記録（2つの月間グリッドで縦に長い）も同様に確認した
（`screens/08-mood-bottom.png`）。

## 撮影した画面（`screens/`ディレクトリ）

| ファイル | 画面 | 経路 |
|---|---|---|
| `01-sign-in.png` / `01-sign-in-desktop.png` | サインイン | 直接 |
| `02-home.png` / `02-home-desktop.png` | ホーム | ゲストではじめる |
| `03-calendar.png` | カレンダー | タブバー |
| `04-timeline.png` / `04-timeline-bottom.png` | タイムライン | タブバー |
| `05-memory.png` | 思い出 | 機能パネル |
| `06-stats.png` | 統計 | 機能パネル |
| `07-list.png` / `07-list-bottom.png` | リスト | 機能パネル |
| `08-mood.png` / `08-mood-bottom.png` | 気分の記録 | 機能パネル |
| `09-profile.png` | マイページ（ゲスト表示） | タブバー |

すべてゲストモード（未認証のデモ閲覧）での撮影。コンソールエラーは
0件だった（`page.on("pageerror")`で監視）。

## 確認できなかったもの（範囲外として明記）

- **マイページの編集フォーム（認証済み表示）・アカウント削除・投稿作成
  モーダル**: ゲストモードではプロフィール画面が「マイページはログイン
  すると使えます」という別表示になり（014の既存仕様。今回変更していない）、
  そこから先（削除確認・投稿フォーム）へは実際のGoogle認証が要る。
  ヘッドレスでのGoogle OAuthログインは行っていないため、**この3画面は
  スクリーンショットでの確認ができていない**。コードレビューでは
  他画面と同じ`Screen`・`Card`・`Button`・`paddingBottom:
  TAB_BAR_CLEARANCE`（`profile.tsx`・`delete-account.tsx`は対応済み。
  `compose.tsx`はモーダル表示のためタブバーの重なりの対象外）を
  使っていることは確認した
- **背景の光のボケ・数字のグラデーション**は視覚仕様の範囲で対応済み
  （`artifacts/035/step4.md`参照）。今回のスクリーンショットでは
  ボケがやや弱く見えるが、Aから「フォントの方が効く。過剰投資しない」
  との指示を受けており、追加調整はしていない

## テスト

`pnpm --filter @futary/app test`（222件緑）・`type-check`・`lint`、
全て通過（サインイン・タブ画面の変更後に再実行）。
