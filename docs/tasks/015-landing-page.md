# 015: ランディングページ

## 目的
公開URLを開いた瞬間の第一印象を作る。
React Native Web ではなく素の HTML/CSS で書くことで、Webらしい見た目と
OGP・SEO を確保する（ADR-002）。

## 変更対象ファイル
- （新規）`apps/landing/index.html`
- （新規）`apps/landing/style.css`
- （新規）`apps/landing/assets/` — ロゴ、スクリーンショット、OGP画像
- `apps/api/wrangler.toml` — Static Assets の設定
- （新規）ビルドスクリプト — `apps/landing` の出力と `apps/app` の Web エクスポートを1つの公開ディレクトリに合成する

## 実装内容

### 構成（上から）
1. ロゴ「futary」とタグライン「ふたりの毎日を、もっと特別に。」
2. 「デモを見る」ボタン（`/app` へ。ログイン不要である旨を添える）
3. 主要機能の紹介 — 投稿 / カレンダー / 統計 / 思い出し の4つ。スクリーンショットを添える
4. 技術構成の紹介 — **転職アピール用**。使用技術と、設計上の判断を数点
   - 「認可を `ctx.coupleId` に集約し、手続きの引数から `coupleId` を排除した」など、
     `docs/decisions.md` から具体的な判断を抜き出す
   - GitHub リポジトリへのリンク
5. フッター

### ルーティング
| パス | 中身 |
|---|---|
| `/` | このランディングページ |
| `/app/*` | Expo Web エクスポート（SPA フォールバック） |
| `/api/*` | Hono + oRPC |

### 必須事項
- OGP（`og:title` / `og:description` / `og:image`）と Twitter Card を設定する
- `lang="ja"`、適切な `<title>` と `<meta name="description">`
- CSP を設定する（`docs/security-requirements.md` 7節）
- Web フォントを読み込まない。ロゴは画像
- スマホ幅で読める。横スクロールが発生しない
- 画像に `width` / `height` を指定してレイアウトシフトを防ぐ

## 確認観点
- OGP が正しく展開されるか（SNSのカードプレビューで確認する）
- スマホ幅・PC幅の両方で破綻しないか
- `/app` への遷移が動くか
- 初回表示が速いか（外部リソースを読み込んでいないか）
- 技術構成の説明が、実際の実装と食い違っていないか

## 完了条件
- [x] `/` にランディングページが表示される
- [x] `/app` でアプリが開き、`/api` が動く
- [ ] **OGP のプレビューが確認できている**（構造〈og:title/description/image・Twitter Card〉は
      実装・確認済みだが、公開ドメイン未決〈論点L1〉のためSNSでの実際の展開確認は
      016のデプロイ後。`artifacts/015/manual-check.md`参照）
- [x] スマホ幅で横スクロールが発生しない（375px幅で実測）
- [x] `artifacts/015/` に証跡を保存（実際の画面キャプチャはconventions.md 8節の方針
      〈タスクごとにスクリーンショットを撮らない。016が唯一の機会〉に従い、
      `wrangler dev`での動作確認結果を`test-results.md`に文章で記録した）

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション
- 公開ドメイン（論点L1）が未決の場合は `*.workers.dev` で進め、`state.md` に記録する
      → **未決のまま`*.workers.dev`で進めた。`state.md`に記録済み**

## 進捗
- [x] ビルドスクリプト（LP + アプリの合成。`scripts/build-public.mjs`）
- [x] ルーティング設定（`apps/api/wrangler.toml`の`[assets]`。`run_worker_first`は`/api/*`のみ）
- [x] LP の HTML / CSS
- [x] スクリーンショット素材（既存アイコン・自作OGP画像を使用。実写真は無し）
- [x] OGP / メタ情報 / CSP
- [x] 技術構成セクション
- [x] 証跡保存 → `state.md` 更新 → `worklog.md` 追記
