# fix/fab-shadow-square — 手動確認

実行日: 2026-08-30 / セッションB
発見経緯: 人間が実機でホームの機能パネルを確認していた際、下部タブの
「＋投稿」FABの周囲に薄い四角い枠が見えると画像付きで報告した。

## 観測した事象

丸いピンクの「＋」ボタンの背後に、うっすらと四角い枠（影）が見えており、
画面になじんでいなかった（人間の添付画像で確認）。

## 原因

`apps/app/app/(tabs)/_layout.tsx`の`FabTabButton`が、`Pressable`に
`shadow.fab`（`shadowColor`/`shadowOpacity`/`shadowRadius`/`shadowOffset`）
を直接適用していたが、その`Pressable`自身には`borderRadius`が無かった。

`Card`（`packages/ui/src/components/card.tsx`）は同じ`shadow.*`トークンを
適用する際、必ず`borderRadius: radius.card`もあわせて設定している。
react-native-web は `shadow*` 系プロパティを CSS の `box-shadow` に変換するが、
影の形は要素の**ボックスの形**に従う。`borderRadius`が無い正方形の
`Pressable`（56×56、中の`Image`は円形の「＋」ボタンを描いている）に影を
落とすと、円の輪郭ではなく元の正方形の輪郭のまま薄く広がった影になる。
これが「四角い枠」に見えていた。

## 修正

`Pressable`のstyleに`borderRadius: 28`（`Image`の56pxの半分）を追加した。
影がボタンと同じ円形の輪郭で落ちるようになる。`Card`が`shadow.card`と
`borderRadius`を必ず対で持たせているのと同じ形に揃えた。

## 再発を防ぐ手段

自動テストとしての回帰テストは追加していない。react-native-web + jsdom の
結合テスト環境では、影の実際の描画形状（box-shadowがボックスの角丸に
追従するか）を検証できないため、`conventions.md`6節「レイアウトに依存する
計算はテストできない」に該当する。目視確認（人間の実機確認）に依存する。

## 影響範囲

`apps/app/app/(tabs)/_layout.tsx`の`FabTabButton`1箇所のみの変更。
他に`shadow.*`を直接使っている箇所は`Card`のみで、そちらは元から
`borderRadius`とセットになっており対象外（`packages/ui`内をgrepして確認）。

## 動作確認

**未実施。** ホーム・タブバーは認証必須の画面のため、B（自動化）は
ブラウザでの実機確認ができない（011以降と同じ制約）。人間の実機確認を
依頼する。

## Rレビューでの追加対応

Rが受け入れたうえで、任意の提案2件を出した。両方このPRに反映した。

1. **`shadow`トークンに`borderRadius`と対で使う旨のコメントを追加。**
   `packages/ui/src/tokens.ts`の`shadow`定義の直前に1行追加した。
   `shadow`はこのリポジトリで唯一「他プロパティとの対」を要求するトークンで、
   その要件がどこにも書かれていなかった（`Card`の実装を読めば分かるが、
   今回のFABのように`Card`を読まない箇所では気づけない）。
2. **FABの`56`（画像サイズ）と`28`（borderRadius）が別々の数値として
   並んでいたのを、`FAB_SIZE`定数から両方を導出する形に変更。**
   片方だけ変えて片方を忘れると同じ不具合が黙って戻る（テストで検出
   できないため）ことを防ぐ。002の「FABの直径はこの1箇所でしか使わない
   寸法なのでトークン化しない」という判断はそのまま維持し、
   同一ファイル内の定数として関係だけを書いた。

## テスト・型チェック・lint

- `pnpm --filter @futary/app run test`: 96件すべて緑。詳細は`test-results.txt`
- `pnpm --filter @futary/app run type-check`: 通過。詳細は`type-check-results.txt`
- `pnpm --filter @futary/ui run type-check`: 通過（tokens.tsのコメント追加のみ）
- `pnpm lint`: エラーなし。詳細は`lint-results.txt`
