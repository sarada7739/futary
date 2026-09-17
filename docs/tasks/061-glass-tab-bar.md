# 061: 下部タブバーを湾曲ガラスにする

## 目的

**人間の指示。**下部タブバーの白い不透明な背景を、湾曲したガラスが背景を屈折させる
表現に置き換える。タブの項目・遷移・状態管理は変えない（見た目だけ）。

## 0. 先に決めたこと

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | 方式 | **CSS**（`backdrop-filter` と SVG フィルタ）。WebGL は採らない | WebGL は自分でテクスチャにした絵しか歪ませられない。背景は通常の DOM で、Safari にそれをテクスチャにする手段が無い（`drawElementImage` は Chromium のフラグ付き・WebKit は未表明、DOM スナップショットは毎フレーム不可）。WebGL にすると Safari では背景が透けすらしなくなる |
| 2 | iOS 26 の OS 標準 Liquid Glass | **使わない** | `expo-glass-effect` は `.ios.js` しか実装を持たず、Web では `GlassView` がただの `View`・`isLiquidGlassAvailable()` が `false`。ネイティブのビルド構成（`ios/`・`eas.json`）自体が無く、配信は Web だけ |
| 3 | ぼかしと屈折の層 | **分ける。**ぼかしは `url()` を含めない | `backdrop-filter` に `url()` を含めると、解釈しない WebKit・Firefox が**宣言ごと**捨てる。1つにまとめるとぼかしまで消える |
| 4 | Safari での屈折 | **ガラス板そのものを歪ませる**（通常の `filter: url()`。全ブラウザで効く） | 背後の絵を歪ませられるのは Chromium だけ。板の側を歪ませれば、ぼかした地の上でガラスとして読める |
| 5 | SVG フィルタの置き場 | **`apps/app/app/+html.tsx`**（文書に1度だけ） | `filter: url(#id)` は同じ文書の定義しか引けない。画面側に置くと、タブバーの無い画面で定義が消えて参照が壊れる（参照できないフィルタを指定した要素は描画されなくなる）。`react-native-svg` は入れない |
| 6 | 変位マップ | **R に横・G に縦のランプを焼いた画像**（中央 0x80 で平ら） | 「フチに近いほど歪み、中央はほぼ素通し」を作る。`feTurbulence` のランダムノイズは中央も一様に歪めるため使わない |
| 7 | ホワイト外観（039） | **ガラスにする。ただし色を持たせない。**色収差は 0、影は無し（`shadow.card` の不透明度 0 のまま） | 039「真っ白な平らな地・装飾は無い」に沿う。虹色のにじみはピンクの語彙（`shadow.glow` を 0 にしたのと同じ理由） |
| 8 | ピルの動き | **`Animated` と `PanResponder`**（React Native コア） | `react-native-reanimated`・`react-native-gesture-handler` は `apps/app` から解決できない（expo-router の推移的依存）。直接依存を増やさずに済む |
| 9 | タブバーの差し替え方 | **`Tabs` の `tabBar` にカスタム部品を渡す** | 層が4枚要り、`tabBarStyle` の style 1枚では積めない。navigator 自体は置き換えない |
| 10 | 新しいパッケージ | **足さない** | 上の 5・8 のとおり |

## 1. 変更するもの

| ファイル | 内容 |
|---|---|
| `packages/ui/src/theme.ts` | `Glass` 型と `glass` トークンを両外観に追加（`colors`・`shadow`・`gradients` は1つも変えない） |
| `packages/ui/src/index.ts` | `Glass` 型を export |
| `apps/app/app/+html.tsx` | 変位マップと SVG フィルタ2本（ピンク・ホワイト）を body の先頭に置く |
| `apps/app/components/glass-tab-bar.tsx` | 新規。ガラスの板（ぼかし・屈折・色収差・フチ）とレンズのピル、項目の描画 |
| `apps/app/lib/tab-pill.ts` | 新規。ピルの位置の計算（純粋な関数。描画から切り離す） |
| `apps/app/app/(tabs)/_layout.tsx` | `tabBarStyle` などの見た目の指定を外し、`tabBar` を渡す |

**寸法（`lib/tab-bar-layout.ts`）と各画面の `TAB_BAR_CLEARANCE` は変えない。**
タブバーは元から `position: absolute` で、コンテンツは既に下へ回り込む。

## 2. テストで証明すること

| # | 何を | どこで |
|---|---|---|
| P1〜P5 | ピルの位置・寄せ先・速さによる伸び・端での丸め・スロット幅 0 で NaN にならない | `apps/app/test/tab-pill.test.ts` |
| G1 | `href: null` の画面はタブに出ない。`tabBarButton`（＋投稿）はその部品が描かれる。アイコンは `tabBarIcon` から引く | `apps/app/test/glass-tab-bar.test.tsx` |
| G2 | 選択中の項目にだけ `aria-selected` が付く | 同上 |
| G3 | `tabPress` を emit し、止められなければ navigate する。選択中は navigate しない。`preventDefault` されたら navigate しない（＋投稿の経路） | 同上 |
| G4 | ピンク・ホワイトの両方で描ける | 同上 |
| G5 | **ぼかしの宣言に `url(` を含めない。**屈折は `backdrop-filter` と `filter` の両方に置く | 同上（ソースの不変条件） |
| G6 | **`theme.ts` の `filterId` が全部 `+html.tsx` に定義されている**（ずれると参照が壊れてタブバーが消える） | 同上 |
| T5 | `glass` のキーが両外観で同一。`filterId` は外観ごとに別。ホワイトの色収差は 0。ぼかしは両方 0 より大きい | `packages/ui/test/theme.test.ts` |

## 3. 確認観点（人間の実機）

- iPhone Safari: タブバーの下に投稿・写真をスクロールさせ、**透けてぼけて見える**
- iPhone Safari: フチが歪んで見える（板の屈折）。中央は素通しに近い
- PC Chrome: 背景そのものが**フチで内側へ引き込まれる**（Chromium だけの本物の屈折）
- ピルを指でドラッグすると追従し、離すと最寄りのタブへ寄る。速く振ると先へ飛ぶ
- ホワイト外観で、色が付いていない（虹色のにじみが出ない）
- LP のスマホ枠（iframe。056）の中でも重くならない
- 発熱・電池の体感

## 4. やらないもの

| | 扱い |
|---|---|
| WebGL・canvas での屈折 | しない（0節 #1） |
| `expo-glass-effect`（iOS 26 の OS 標準） | しない（0節 #2）。iOS アプリ化のときに分岐を足す |
| `react-native-svg`・`reanimated`・`gesture-handler` の追加 | しない（0節 #5・#8） |
| タブの項目・遷移・寸法の変更 | しない（見た目だけ） |
| `docs/architecture.md` 7節の書き換え | **A の手番**（下記） |

## 5. A へ申し送る

- **`architecture.md` 7節にガラスのトークンを書く。**デザイントークンの単一の源はこの節で、
  `glass`（`filterId`・`blurRadius`・`saturate`・`tint`・`rim`・`edgeHighlight`・
  `edgeReflection`・`aberration`・`lensTint`・`lensRim`）が増えた
- **039 の「装飾は無い」との関係。**ホワイトもガラスにしたが、色収差と影は 0 にして
  039 の決定は動かしていない。この解釈でよいか
- **Safari では本物の屈折が出ない**ことを仕様として書くかどうか

## 完了条件

- P1〜P5・G1〜G6・T5 が緑、型チェック・lint・全テストが緑
- 人間の実機（3節）
