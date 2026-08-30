# fix/panel-icon-grid — 手動確認

実行日: 2026-08-30 / セッションB
発見経緯: 019+020の受け入れ依頼に対する人間の反応（L81・L82）を受け、
A（Aの判断・PR #131・#132）の設計に沿ってホームの機能パネルを
カード形式からアイコングリッドに作り直した。

## 変更内容

- パネル用アイコン6個をSVGで新規に描き起こし、96×96のPNGとして
  `packages/ui/assets/panel-{memory,stats,today,list,mood,ai}.png`に配置。
  単線・角丸・単色（`#4A3733`。既存のタブアイコンと同じ色）、`揃える点`
  （`docs/sample/README.md`）どおりの様式。タイムライン・カレンダーは
  既存の`iconTabTimeline`/`iconTabCalendar`を使い回した
- `packages/ui/src/assets.ts`に`iconPanelMemory`等としてexport追加
- `apps/app/components/feature-panel.tsx`を全面書き換え。`Card`をやめ、
  アイコン（32pt）＋ラベルのみ（説明文は廃止）。枠線・背景を持たない
  （押せる/押せないの差を枠ではなく濃さで見せる。PR #132の指示どおり）。
  ラベルは2行まで折り返し可、セルの高さは8枚とも92pxで固定
- `apps/app/app/(tabs)/index.tsx`のパネル部分を`flexDirection:"row"`+
  `flexWrap:"wrap"`の4列グリッドに変更
- `packages/ui/src/components/text.tsx`に`align`プロップ（`left`/`center`/
  `right`。既定`left`）を追加。既存の`size`/`color`/`weight`と同じ
  「curated propsのみを公開し、生の`style`は渡させない」設計方針を維持した
  まま、ラベルの中央揃えを可能にした

## 再発を防ぐ手段・回帰テスト

`apps/app/test/home-screen.test.tsx`（既存10件。ラベル表示・遷移・
「次フェーズ」バッジ・「準備中です」不使用を検証）は`FeaturePanel`の
内部実装を問わずラベルテキストとクリック挙動だけを見ているため、
**変更なしでそのまま通過した。**グリッドの実際の見た目（4列に並ぶか、
高さが揃うか）はjsdom結合テストでは検証できず、目視確認に依存する
（`conventions.md`6節）。

## 動作確認

**未実施。** ホーム画面は認証必須のため、B（自動化）はブラウザでの実機確認
ができない。`artifacts/020/manual-check.md`に項目13・14として追加した。

## テスト・型チェック・lint

- `pnpm --filter @futary/app run test`: 96件すべて緑
- `pnpm --filter @futary/ui run test`: 7件すべて緑
- `pnpm --filter @futary/app run type-check` / `@futary/ui run type-check`: 通過
- `pnpm lint`: エラーなし
