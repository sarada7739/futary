# 052（PR #367）— R の判定

futary-R で dd4db9c を checkout して実行した。app 538 緑・`tsc --noEmit` 緑・`eslint .` 緑。CI pass。差分は `apps/landing`（2 ページ + フッター）・`scripts/build-public.mjs`（`cpSync` 2 行）・`legal-links.tsx`・サインイン/マイページの入口・`ai.ts` のコメント・テスト・証跡。サーバの手続き・契約・DB に差分無し。`worklog.md` は追記のみ。触ったものは戻した。

**判定: 受け入れ。必須修正なし。**

## 自分で確かめたこと

- **T2**: `grep -c '【'` は `privacy.html`・`terms.html` とも 0（`docs/legal/privacy-policy-draft.md` も 0。`terms-draft.md` の 1 件は 8 節の「048 で足す」の置き場で、HTML には写していない）。`check-text.py` を自分で走らせて privacy 73 行・terms 40 行とも一致（exit 0）。文面は草案のまま
- HTML: inline script・inline style・`onclick` 無し（CSP は `_headers` の `/*` で `index.html` と同じ）。生の `&` 無し。`href` は `/`・`/privacy`・`/terms`・`/style.css`・`/assets/*` だけ。`futary` の文字無し
- **T1**: `t1.txt` で `/privacy`・`/terms` 200 text/html、`/privacy.html` は 307（Cloudflare の正規化）。`_headers` は `/*` なので新しいページにも CSP が付く
- **T3**: `legal-links.tsx` は `Linking.openURL(getApiOrigin() + path)`。本番は同一オリジンなので `window.location.origin`。`Pressable` は `accessibilityRole="link"` で副作用が無い（`conventions.md` 4節の「Button を通す」の対象外）。壊して確かめた: サインインから外す → 2 本赤、マイページのログイン後から外す → 1 本赤、ゲストから外す → 1 本赤、URL を `/privacy.html` に → 2 本赤
- 0節 #3「新しい CSS を書かない」: `style.css` に差分無し。既存クラスだけ
- 0節 #5: `cpSync` 2 行。停止条件「構造を変える必要」には当たっていない
- 0節 #6 の `conventions.md` 8節の 1 行は A が 1887597 で入れている（この PR の外。整合）
- 0節 #7: `releases.ts` に差分無し
- `ai.ts` のコメント: 「データ共有はオフ（人間がダッシュボードで）」= ポリシー 3 節の実体。ADR-013 の同意文言と一致する説明
- `landing-terms.png`（390px）を見た: 節ごとのカード・表・フッターのリンク。横スクロール無し（`t3.txt`）

## 記録（判定に使わない。1 は A へ）

1. **利用規約の節番号が 7 → 9 に飛ぶ**（8 節を見出しごと省いたため。B の報告どおり）。読む人には欠番に見える。「文面を変えない」約束のうちなので B の判断は妥当だが、公開ページなので **A が「欠番のまま 048 段階2 まで待つ」か「今は 8〜10 に詰めて 048 で挿す」かを決める**。草案の側を直せば B は写すだけ
2. 表はスマホ幅で列が狭い（B の報告どおり。読める）。CSS を足すかは A の判断。急がない

## 私が確かめていないこと

- 人間の手番 2 つ（Google の OAuth 同意画面に `/privacy` を登録・OpenAI のデータ共有をオフ）
- `landing-privacy.png`・`app-sign-in.png`・`app-profile-guest.png`・`landing-footer.png` は見ていない（`landing-terms.png` を見た）
