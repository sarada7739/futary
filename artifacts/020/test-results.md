# 020: ホームの再構成 — テスト結果

実行日: 2026-08-30 / セッションB

## `pnpm type-check`

全ワークスペースで通過（exit 0）。

## `pnpm lint`

`eslint .` エラーなし。生の16進カラーの混入も無いことを確認済み
（新規/変更ファイルを`grep`で確認）。

## `pnpm test`

apps/app 81件→96件（+15。home-screen.test.tsx新設9件・
timeline-screen.test.tsx〈旧home-timeline.test.tsx〉統計/思い出しモック削除・
memory-screen.test.tsx新設1件・stats-screen.test.tsx新設4件・
stats-card.test.tsxはlib/stats.tsへの関数移動のみで件数変わらず）。

## 事前調査: R・Aによる先読み（019のhiddenとの食い違い2件）

着手前にRが019の`hidden`（daysを含まない）と020のタスク定義（「統計ページに
4つ全部」「記念日カードごと非表示」）の食い違いを2件指摘し、Aが判断した
（PR #126）。

1. **統計ページは4つ。hiddenのときは3つ。**「4つ全部」は書けない
   （`stats.get`が`hidden`のとき`days`を返さないため）
2. **hiddenで消すのは記念日の行だけ。会った日数は残す。**カードごとは消さない
   （人間が「恥ずかしい」と言ったのは交際/結婚日数の方であり、会った日数を
   隠す指示はどこにもない）

実装したところ、2はホームの記念日カード（`stats-card.tsx`）が**既に
この形で実装済み**だった（019時点で`daysTogetherLabel`だけを条件付き表示し、
`会った日数`は常に表示する形にしていたため。019の実装がAの決定と
一致していたことを、この場で確認できた）。1（統計ページ）は新規実装のため、
最初からこの形で作った。

## 内訳（新規/変更ファイル）

- `apps/app/app/(tabs)/timeline.tsx`（新規） — 旧ホームの投稿一覧をそのまま
  移した（ロゴ・統計カード・思い出しカードは外した）
- `apps/app/app/(tabs)/index.tsx`（全面書き換え） — ロゴ・記念日カード
  （`StatsCard`）・機能パネル8枚の構成に変更
- `apps/app/app/(tabs)/_layout.tsx`（変更） — `検索`タブを`タイムライン`
  タブに置き換え
- `apps/app/app/(tabs)/search.tsx`（削除）
- `apps/app/components/feature-panel.tsx`（新規） — 動く/次フェーズ両方を
  1つのコンポーネントで表す。`onPress`の有無だけで分岐し、「準備中です」
  という文言は使わない
- `apps/app/app/(tabs)/memory.tsx`（新規） — 013の`MemoryCard`をそのまま
  出すだけのページ（新しいカードは作らない）
- `apps/app/app/(tabs)/stats.tsx`（新規） — 012の4つの数字を全部出すページ。
  `hidden`のときは記念日の行だけ出さず3つになる
- `apps/app/app/(tabs)/_layout.tsx` — `memory`・`stats`を`href: null`の
  非表示タブとして`(tabs)`navigator内に登録（**当初はルートのStackに
  置いていたが、Rレビューで指摘を受け修正**。ルートのStackに置くと
  `(tabs)`の外に出るためタブバーが消える。L70でcalendar.tsxが同じ構造で
  タブバーが消えた不具合を踏んでいたのと同じ形だった）
- `apps/app/lib/stats.ts`（新規） — `daysTogetherLabel`を`stats-card.tsx`
  から切り出し、`stats.tsx`と共有（表示名の決め方を2箇所に持たない。019と
  同じ方針）
- `packages/ui/assets/tab-timeline.png`（新規） — タイムラインタブの
  アイコン。素材シートに該当図案が無いため、カレンダーアイコン（
  `fix/persistent-tab-bar`）と同じ手順でSVGから描き起こしラスタライズした
  （`docs/sample/README.md`に記録）

## B目線で気づいた点（Aが対応済み。PR #128）

- `docs/requirements.md`5節の「検索 | ボトムタブに枠はあるが中身は次フェーズ」
  の行が、本タスクで`検索`タブ自体が無くなったため古くなっていた → 状態欄を
  修正（スコープ外であること自体は変更なし）
- 020のタスク定義冒頭「モックアップの7枚をそのまま置く」と、直後のパネル表
  （8行）の数が食い違っていた → **表の8枚が正しい**（Aがモックアップに無い
  「タイムライン」を意図して足していた）。実装（表どおり8枚）が正しかった
- `docs/architecture.md`7節の「ナビゲーション」節が、まだ「ボトムタブ5つ:
  ホーム/カレンダー/＋投稿/検索/マイページ」のままだった → 020の内容を反映し、
  変更履歴の表（当初→018→020）を追加

## Rレビュー指摘（対応済み）

- `memory.tsx`・`stats.tsx`をルートのStackに置いていたため、遷移すると
  タブバーが消えていた（L70と同じ構造の不具合）。`(tabs)`navigator内に
  `href: null`で移し、タブバーが常に出る形に修正した
- `packages/ui/src/assets.ts`の`iconTabSearch`が未使用になった。急ぎでは
  ないため016の公開前の掃除に持ち越す（Rの提案どおり）
