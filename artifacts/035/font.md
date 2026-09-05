# 035: 書体仕様の実装結果

Aの書体仕様（`docs/tasks/035-rich-ui.md`「書体仕様」節。PR #237）を
「やる順」の1〜5に沿って実装した。

## 1. `fontFamily.ja`（0KB）

`packages/ui/src/tokens.ts`に`fontFamily.ja`（ヒラギノ→BIZ
UDPGothic→Meiryo→Yu Gothic UI→Noto Sans CJK JP→Noto Sans JPの順）を追加し、
共有`Text`コンポーネントの既定にした。共有コンポーネントを経由しない生
`RNText`（記念日カード・機能パネル・デモバナー・サインインのタグライン・
`Button`内部）にも個別に適用した。

**適用前後を撮影して比較した**（`font-step1-home.png`・
`font-step1-signin.png`）。Windows（Chrome）でもかなの線が太く大きく見える
ようになり、Aが指摘した「Yu Gothicの細さ」が解消されたことを確認した。

## 2. Poppinsのself-host

`apps/app/public/fonts/`に`poppins-500.woff2`・`poppins-700.woff2`
（latin サブセット、各約7.6KB）を配置し、`apps/app/app/+html.tsx`の`<head>`
に`@font-face`をインラインで書いた（`rel="preload"`も追加）。Google Fonts
のCDNは参照していない（配置したファイルはGoogle Fontsから一度だけ取得した
ものだが、アプリが実際に読み込むのは自ホストの`/fonts/*.woff2`のみ）。

`fontFamily.numeric`（`"Poppins", ` + `ja`と同じ列）を新設し、「数字が
主役の箱」だけに当てた: 記念日カードの72pt（`stats-card.tsx`）・会った
日数の「94」・`COMING SOON`。「ゆい／れん」「付き合って」「会った日数：」
「日」などの日本語には引き続き`fontFamily.ja`のみを使い、混植していない。

実際に`document.fonts`でPoppinsが`status: "loaded"`になることを確認した。

### 開発サーバー固有の詰まり（記録）

`+html.tsx`は`${baseUrl}`（`app.json`の`experiments.baseUrl="/app"`）を
既存のapple-touch-icon等と同じ形でパスに含めているが、**ローカルの`expo
start --web`ではpublic配下のファイルがこのプレフィックス無しのルート
（`/fonts/...`）で配信され、`${baseUrl}`付きのURL（`/app/fonts/...`）は
404になる**ことを実測で確認した（`apple-touch-icon.png`も同様に404で、
035より前から存在する既知の状態と判明。今回はじめて実測して気づいた）。
本番の静的書き出しでは`${baseUrl}`が実際の配置と一致するはずのため
（030のタスク定義のコメントに実測記録あり）、コード自体は`${baseUrl}`の
ままにし、**ローカルでの見た目確認だけ一時的にプレフィックス無しへ書き
換えて撮影し、確認後に`${baseUrl}`へ戻した**（差分に残していない）。

## 3. `weight`に`medium`(600)を追加

共有`Text`コンポーネントの`weight`に`"medium"`(600)を追加した
（`regular`/`medium`/`bold`の3値）。機能パネルのラベルは元々600相当の
生`RNText`実装だったため、`fontFamily.ja`を追加した以外は変更なし。

## 4. 字間・行送り

| 要素 | 値 | 備考 |
|---|---|---|
| サインインのタグライン2行 | weight400・字間0.15em（2.4px@16pt）・行送り1.9（30.4px@16pt） | 共有TextはletterSpacing/この行送りを持たないため生Textで実装 |
| ボタンの文字（`Button`内部） | weight700・字間0.04em（0.64px@16pt） | 同上 |
| デモバナーの「ログイン」 | weight700・字間0.04em（0.44px@11pt） | 同上 |
| `COMING SOON` | Poppins weight500・字間0.08em（0.64px@8pt）・大文字 | 元は`letterSpacing:0.8`（はみ出し対策の暫定値）だったが、仕様の0.08em（0.64）に置き換えた。1行に収まることを実測で再確認する必要がある（下記） |

## 5. 72ptの数字: 700 vs 800

**Aの指示どおり、決めずに両方撮って並べた。**`font-number-700.png`・
`font-number-800.png`（フルスクリーンショット）と、数字部分だけを縦に
並べた`font-700-vs-800.png`（上が700、下が800）。

比較には`+html.tsx`に**比較専用の`@font-face`（weight800。
`poppins-800.woff2`）を一時的に追加**し、`document.fonts`で該当ウエイトが
実際に`loaded`になっていること（ブラウザの疑似太字ではなく本物のウエイト
であること）を確認した上で撮影した。

**目視した限り、800の方が明らかに線が太い。**Aが懸念していた「背景に
乗ると細く見える」という点では、800の方が安全に見える。ただし判断は
お任せする（指示どおり自分では決めていない）。

**800を採用する場合**: `+html.tsx`のコメント「FONT_WEIGHT_COMPARISON_TEST」
以下はそのまま本採用（コメントだけ整理）。
**700を採用する場合**: `poppins-800.woff2`・該当`@font-face`・
`stats-card.tsx`の`fontWeight`を700に戻し、比較用一式を削除する。

## テスト

`pnpm --filter @futary/app test`（222件緑）・型チェック・lint、全て通過。
COMING SOONの`letterSpacing`を0.08em（0.64）に変えたことで、以前解消した
「今日どうだった？」パネルのはみ出しが再発していないかは、Aの決定
（700/800）を受けて次のコミットで撮り直して確認する。
