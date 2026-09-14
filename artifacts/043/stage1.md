# 043: リリース履歴 — 実装の報告

2026-09-14 / セッションB。タスク定義（`docs/tasks/043-release-notes.md`）の 0〜3節に従って実装した。
人間の実機（シート → 閉じる → 出ない）はデプロイ後。

## 作ったもの

- `apps/app/lib/releases.ts`: `Release` 型・`RELEASES`（11 項目。新しい順）・`LATEST_VERSION`・`LATEST_RELEASE`・`formatReleaseDate`（`YYYY-MM-DD` → `YYYY.MM.DD`。文字列の置き換えだけ）。表も手続きも無い（0節 #1）
- `apps/app/lib/release-seen.ts`: `hasUnseenRelease()`・`markReleaseSeen()`（`window.localStorage["futary.releaseSeen"]`）・`isReleaseDeferred()`・`deferRelease()`（`window.sessionStorage["futary.releaseLater"]`）。比較は文字列の一致だけ。ストレージが例外なら **既読扱い**（0節 #9）。`useHasUnseenRelease()` は `useSyncExternalStore` で、一覧の画面が `markReleaseSeen()` を呼んだ瞬間にホームのバッジが消える（Tabs の中の画面は遷移しても mount されたままなので、フォーカスのフックに頼らない）。静的書き出しのサーバ側の描画は false
- `apps/app/components/release-button.tsx`: ホームの 3×3 の下、全幅 1 本。左に ✦（`iconReleases`。線画。primary で塗る）・中央「リリース履歴を見る」・右 ›。未読なら右上に NEW。形は `Button` の secondary と同じ語彙（surface の地・primary の 1px 枠・押すと surfaceTint）。押すと `/releases`
- `apps/app/components/new-badge.tsx`: 「NEW」「NEW!」のピル（primary の地・surface の文字。3 箇所で共用）
- `apps/app/components/release-sheet.tsx`: 「新機能のお知らせ」。絵（**ホワイトは見本の贈り物を切り出した `releaseGift`、ピンクは既存の `sparkle`**。分岐は部品の中）→ NEW → 題名 → 副題 → カード（ホームのそのパネルの写真タイル `panelPhoto*` を route から引く。新しい絵は作らない。`title`・`items` の先頭 2 行・「使ってみる ›」は `route` があるときだけ）→「後で通知する」→「閉じる ×」。`components/sheet.tsx` を使う（`title` を省略できるようにした。既存の呼び出しは変えていない）
- `apps/app/app/(tabs)/releases.tsx`（`href: null`。`_layout.tsx` に足した）: ヘッダー「リリース履歴」+ **‹ 戻る**（`/` へ固定。album-detail と同じ理由）。先頭に「これまでのアップデートをご紹介。」。カードは `Card`（最新だけ `accent` で枠が primary + NEW!）。日付（Poppins 18 bold）・版のチップ（surfaceTint）・題名・箇条書き（primary の 6px の点）・`route` があれば「新機能を見る →」（primarySubtle のピル）。開いた時点で `markReleaseSeen()`
- `apps/app/app/(tabs)/index.tsx`: ボタンとシートを組み込んだ。シートは **描いたあと（`useEffect`）に開く**（静的書き出しでは window が無く、初期値で開くと hydrate と食い違う）。「閉じる ×」・外 = 見た。「使ってみる」= 見た + `router.push(route)`。「後で」= `sessionStorage` に書いて閉じるだけ
- `packages/ui`: `Card` に `accent?: boolean`（枠を primary に。両モードで 1px）。`assets.ts` に `iconReleases`・`releaseGift`。素材の出自は `docs/sample/README.md`「043 で作ったもの」
- `apps/app/test/setup.ts`: `sessionStorage` も in-memory Storage で補う（Node 25.2 ではメソッドがあるが、無いときだけ補う形）
- 見本: 人間が渡したピンクの 4 枚を `docs/sample/simpleMode/リリース履歴/pink/` に置いて追跡に入れた

## 日付を git で確かめた結果（1節）

`git log --first-parent --date=short main` で各タスクの実装 PR が `main` に入った日を見た。**A の表の日付は全部そのまま。**ただし 2 項目は、同じ項目に入っている行の PR が別の日だった:

| version | A の日付 | 確かめた結果 |
|---|---|---|
| 2.0.0 | 09-14 | 041 段階1 #294・段階2 #300・042 #305 とも 09-14 |
| 1.9.0 | 09-13 | 040 #289 = 09-13 |
| 1.8.0 | 09-13 | 039 段階1 #271・段階2 #275 = 09-13 |
| 1.7.0 | 09-06 | 037 #250 = 09-06 |
| 1.6.0 | 09-05 | 035 #238・036 #243 = 09-05 |
| 1.5.0 | 09-04 | 031 #215・033 #224・030（アイコン）#212 = 09-04 |
| 1.4.0 | 09-02 | 029 #209 = 09-02 |
| 1.3.0 | 09-01 | 027 #196 = 09-01。**「メモを付けられます」の 028 #203 は 09-02**（項目の日付は機能本体の 027 のまま） |
| 1.2.0 | 09-01 | 024 #185・025 #184 = 09-01。**「付き合った日はあとから設定できます」の 023 #162 は 08-31**（同上。024・025 のまま） |
| 1.1.0 | 08-31 | 021 #140・022 #149 = 08-31 |
| 1.0.0 | 08-31 | 016 #172（本番デプロイの記録 1e94954 も 08-31） |

1.3.0・1.2.0 の 1 行ずつが別の日に入ったものだが、項目を分けるかどうかは A の判断（文言の変更は A）。B は日付を変えていない。

## テスト

| # | 何を | どこで |
|---|---|---|
| T1 | 新しい順（`date` 降順。同じ日は許す）・`version` 重複なし・`items` 1〜5 行・各 40 文字まで・`LATEST_VERSION` が先頭・`route` が `app/(tabs)/<name>.tsx` に実在する（`existsSync`）・最新が 2.0.0 で `/album`、初回が 1.0.0 で 🎉 | `test/releases.test.ts`（8 件） |
| T2 | 未読なら NEW・既読なら無い・`localStorage` が例外なら NEW もシートも無い・ホワイトでも同じ。押すと `/releases` | `test/home-releases.test.tsx`「ホームの「リリース履歴を見る」（043 T2）」（4 件）。単体は `test/release-seen.test.ts`（8 件。例外の環境で false・書き込みも投げない） |
| T3 | 未読で出る（最新の 1 項目だけ。3 行目と 1 つ前の版は出ない）・「閉じる ×」で消えて既読（NEW も消える）・外を押しても同じ・「後で」で消えるが未読のまま、同じ起動で開き直しても出ない・次の起動（sessionStorage 空）では出る・「使ってみる」で `/album` へ進み既読・既読なら出ない・ホワイトは贈り物、ピンクは星 | 同「「新機能のお知らせ」のシート（043 T3）」（9 件） |
| T4 | ホームの NEW が、一覧の画面を開いた瞬間に消える（両方を同じツリーに置いて `useSyncExternalStore` の経路を通す）。一覧側は「開いた時点で既読」 | 同「一覧を開くと既読になる（043 T4）」・`test/releases-screen.test.tsx`「開いた時点で既読になる」 |
| T5 | 11 項目が配列の順に全部出る（日付 `2026.09.14`・チップ・題名・箇条書き・🎉）・NEW! は 1 つで最新に付く・最新の枠が primary で 2 番目は違う（jsdom の computedStyle。ホワイトは 2 番目が border）・`route` の無い項目に「新機能を見る」が無い・押すとその画面・‹ 戻る は `/` | `test/releases-screen.test.tsx`（6 件） |
| T6 | オンボーディング（`(onboarding)/index.tsx`）を未読で描いてもシートが無い | `test/home-releases.test.tsx`「オンボーディングにはシートが出ない（043 T6）」 |

- 新規 36 件。既存の `home-screen.test.tsx` はボタンが 1 本増えたぶん、aria-label の並びの期待値に「リリース履歴を見る」を足した（それ以外は変えていない）
- `pnpm -r test`: app 451（042 時点の 415 + 36）・api 591・ui 16・date 66・db 31、全て緑。`pnpm type-check`・`pnpm lint` 緑
- react-native-web の `Modal`（fade）は閉じるとき `animationend` を待つ。jsdom には `AnimationEvent` が無く、React は接頭辞付きの `webkitAnimationEnd` を聞く（実測。`fireEvent.animationEnd` では届かなかった）ので、テストは両方の名前を body の下の全要素に発火してから「消えた」を確かめる（`finishModalAnimations`）

## 動作証跡（`stage1/`。Playwright。`scripts/capture.mjs`）

両モード × 端末幅（390×844）・PC 幅（1280×900）。ログインは 041 の `make-session.mjs` の Cookie。

| ファイル | 何 |
|---|---|
| `{pink,white}-home-sheet[-pc].png` | 未読でホームを開いた直後。シートが出ている |
| `{pink,white}-home-new[-pc].png` | 「後で通知する」のあと。ボタンに NEW |
| `{pink,white}-releases[-pc].png` | 一覧。最新だけ primary の枠と NEW! |
| `{pink,white}-home-seen[-pc].png` | ‹ 戻る のあと。NEW が無く、シートも無い |
| `capture.json` | 各段階の `localStorage`/`sessionStorage` の値と、戻ったあと・開き直したあとの NEW とシートの数（全部 0） |

`capture.json` の要点（4 通り全部同じ）: 開いた直後 seen=null・later=null → 「後で」 seen=null・later=2.0.0 → 一覧 seen=2.0.0 → 戻る NEW 0・シート 0 → 開き直し NEW 0・シート 0。

## B が決めたこと（細かい数字。人間の指示で B）

1. ボタン: 高さ 52・ピル・アイコン 20・NEW は右上に 8pt はみ出す（そのぶん上に余白）。枠は primary の 1px（`Button` secondary と同じ。ホワイトは黒）
2. NEW のピル: 高さ 20・横 10・Poppins 11 bold・字間 0.5
3. 一覧: 日付 Poppins 18 bold・チップ高さ 22・点 6px（`Text` sm の 1 行目の中央）・「新機能を見る →」は primarySubtle のピル
4. シート: 贈り物は幅いっぱい高さ 100（contain）・星は高さ 56・写真タイル 88 の正方形（`radius.input`）・箇条書きは先頭 2 行
5. 一覧の ‹ 戻る は `/` に固定（album-detail と同じ理由）。右の × は置かない（3節）
6. ピンクの見本の一覧にある左の縦線と点（タイムライン風）は付けていない（3節に無い。凝らない）
7. ピンクの見本の一覧の右上「完了」は置かない（3節: 戻るが 1 つあれば足りる）

## やっていないこと

- `package.json` の version との連動・サーバ・端末をまたぐ同期・複数の未読をまとめて出す（5節）
- 停止条件のどれにも当たらなかった（`sessionStorage` は Expo Web で使えた。贈り物の絵は見本から切り出せた）
