# 009: リアクション

## 目的
投稿にリアクションを付けられるようにする。2人しかいないため、
「読んだよ」「いいね」を伝える唯一の手段になる。

## 変更対象ファイル
- （新規）`packages/db/schema/reaction.ts`
- （新規）`packages/db/migrations/xxxx_reaction.sql`
- （新規）`apps/api/src/procedures/reaction.ts` — `reaction.toggle`
- `apps/api/src/procedures/post.ts` — `post.list` の応答にリアクション情報を含める
- `apps/app/components/post-card.tsx` — リアクションボタン

## 実装内容
- スキーマは `docs/architecture.md` 4節に従う。主キーは `(post_id, user_id, kind)`
- `reaction.toggle`: 既にあれば削除、無ければ追加する。`writeProcedure` の上に載せる
- `post.list` の応答に、投稿ごとの
  「リアクション種別ごとの件数」と「自分が付けたかどうか」を含める
  - N+1 クエリにしない。投稿一覧の取得と合わせて1〜2クエリで解決する
- UI は楽観的更新にする（タップした瞬間に反映し、失敗したら戻す）

## リアクションの種類（論点L4）
- **まず `heart` の1種だけで実装する**
- スキーマは `kind` を持つため、後から種類を増やせる
- 複数種類が必要かはレビュー時に R が判断する。B は勝手に増やさない

## 確認観点
- 同じユーザーが同じ投稿に同じ種別を二重に付けられないか（主キー制約）
- 一覧取得が N+1 になっていないか（発行されるクエリ数を証跡に残す）
- 楽観的更新が失敗時に正しく巻き戻るか
- デモモード（未認証）で `reaction.toggle` が `FORBIDDEN` になるか

## 完了条件
- [ ] リアクションの付与・取り消しができる
- [ ] 一覧にリアクション数と自分の状態が表示される
- [ ] N+1 になっていないことを証跡で示している
- [ ] テストが緑。005 の認可テストも緑
- [ ] `artifacts/009/` に証跡（**人間の実機確認の記録**、クエリ数）を保存

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション
- **この時点で M2 完了。人間による受け入れ判定を行う。**
  008 のスクリーンショットは**要件そのものを撤回した**ため、回収する対象は無い
  （`conventions.md` 8節・`state.md` L38）

## 進捗
- [x] スキーマ + マイグレーション（`packages/db/src/schema/reaction.ts`、`0005_reaction.sql`）
- [x] `reaction.toggle`（`apps/api/src/procedures/reaction.ts`）
- [x] `post.list` への集計の組み込み（N+1 回避。`fetchReactionSummaries`）
- [x] UI（楽観的更新。`apps/app/lib/reaction.ts` + `app/(tabs)/index.tsx` + `post-card.tsx`）
- [x] テスト（apps/api 128件・apps/app 27件・packages/ui 7件、すべて緑。詳細は `artifacts/009/test-results.md`）
- [x] security-auditor 実施（M2まとめ監査。006・008・009対象。009固有の指摘はゼロ。
      当初API全体に及ぶHigh 1件〈GET経由の書き込み実行〉を検出し `fix/reject-get-writes`
      で対応したが、**Rレビューでこの指摘は誤りと判明**（`@orpc/server` の `RPCHandler`
      は既定でGETを拒否しており脆弱性は無かった。記述は訂正済み）。009固有のLow 4件は
      本タスク内で対応。詳細は `docs/security-report.md`）
- [x] 証跡保存（`artifacts/009/test-results.md`・`artifacts/009/security-audit-raw.md`）
      → `state.md` 更新 → `worklog.md` 追記
- [x] 人間へ M2 受け入れ判定を依頼。**2026-08-30、人間が実機
      （`wrangler dev --remote`、Google OAuthログイン）でログイン・タイムライン表示・
      画像付き投稿・リアクションの付与取り消しを確認し「動作確認問題なし」と回答した**
      （008の未取得スクリーンショットは別途回収予定。`state.md` L34・L38参照）

### 実装メモ

詳細は `artifacts/009/test-results.md` の「実装メモ」節を参照。要点:

- `reaction.toggle` は `reactions` テーブルが `couple_id` を持たないため、
  DELETE/INSERT 双方の WHERE 句に `EXISTS (SELECT 1 FROM posts WHERE id=?1 AND couple_id=?4 ...)`
  を含める形で他ペアの投稿への到達を防いだ（006の `post.delete` と同じ「WHERE 句で保証する」方針の応用）
- `post.list` のリアクション集計は投稿ID一覧をまとめて1クエリで取得し、N+1にしていない
  （証跡: `apps/api/test/reaction.test.ts` で `D1Database#prepare` の呼び出し回数を検証）
- リアクションの種類は heart の1種のみで実装した（論点L4。B は増やしていない）
- M2まとめ監査対応で `post.delete` を `batch()` 化し `reactions` も同時削除するようにした際、
  推奨実装をそのまま入れると「他ペアの投稿を指定した削除でリアクションだけ消せる」新しい穴を
  自分で作ってしまい、追加した回帰テストで検出して修正した（詳細は `security-report.md`）
- **実機確認で発見**: リアクションをタップすると投稿一覧の画像が点滅する不具合があった。
  `onSettled` での無条件 `invalidateQueries` が原因（`post.list` は呼ぶたびに画像の
  署名付きURLを再発行するため）。`onSettled` を削除し、楽観的更新の結果をそのまま信頼する形に
  変更して解消した。詳細は `artifacts/009/test-results.md` の「実機確認」節参照
