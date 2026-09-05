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

### 【訂正】最初の比較は無効だった

**最初に出した比較（`font-number-700.png`と`font-number-800.png`）は
比較になっていなかった。**Aの指摘で発覚した。原因は2つ重なっていた。

1. **2枚の間で`CARD_HEIGHT`が違っていた**（108→113の修正を挟んで撮った
   ため、`COMING SOON`の行数が700側と800側で違って見えていた）
2. **より重大な問題**: `+html.tsx`のフォントパスを検証用に一時的に
   プレフィックス無しへ書き換えたあと、**本番用の`${baseUrl}`へ戻す
   タイミングが、2枚目（800）の撮影より前だった。**戻した時点で開発サーバー
   では404になる（2節「開発サーバー固有の詰まり」参照）ため、**2枚目は
   実際にはPoppinsが読み込めずフォールバック（システムフォント）で
   描画されていた。**`document.fonts`の`status:"loaded"`だけを見て
   「読めている」と判断し、`getComputedStyle`や実際の描画幅までは確認して
   いなかったのが原因（Aの指摘どおり）。

### やり直した確認

Aの指示どおり、**`getComputedStyle(el).fontWeight`で実際に適用された
ウエイトを確認し、同じ文字の描画幅（`getBoundingClientRect().width`）が
700と800で違う値になることを確認してから**比較した。

- 独立したテストページ（`file://`ではなくローカルHTTPサーバー経由。
  `file://`だとCORSでフォント自体が読み込めないことも実測で分かった）で
  各ウエイト単体を検証: **500→111.44px、700→113.75px、800→114.75px**
  （文字「561」・72pt・letterSpacing -2px）。段階的に幅が増えており、
  3つのファイルが実際に異なる字形で描画されていることを確認した
- 同じ条件（`CARD_HEIGHT`は113で統一）でアプリ本体を撮り直し、
  `computedFontWeight`が"700"・"800"それぞれ正しく反映され、
  実測幅も**113.75px（700）・114.75px（800）**と一致することを確認した
  （`font-number-700.png`・`font-number-800.png`を撮り直し済み）

**正しく比較した結果、700と800の差は非常にわずかだった**（幅で1px、
目視でも僅かに800の方が太い程度）。**最初に報告した「800の方が明らかに
太い」は誤りだった。**訂正する。並べた比較画像も撮り直した
（`font-700-vs-800.png`。上が700、下が800）。

判断は指示どおり自分では決めない。Aの最終判断は**800**（理由: 淡い地に
乗る主役の存在感を優先、ウェイト数は500+800の2つで変わらない）。
`poppins-700.woff2`と該当`@font-face`・比較用コメントを削除し、800を
本採用の状態に整理した。

## テスト

`pnpm --filter @futary/app test`（222件緑）・型チェック・lint、全て通過。
COMING SOONの`letterSpacing`を0.08em（0.64）に変えたことで再発した
「今日どうだった？」パネルのはみ出しは、`CARD_HEIGHT`113で解消済みで
あることを、今回撮り直した`font-number-700.png`・`font-number-800.png`
の両方で確認した（どちらも1行に収まっている）。
