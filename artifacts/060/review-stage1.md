# 060 段階1 — R の判定

futary-R で origin/task/060-strip-comments（6090e3a）を checkout。`build-public.test.ts` 13 件 緑・`apps/api` の `tsc --noEmit` 緑。`worklog.md` は追記のみ（削除行 0）。

**受け入れ。必須修正なし。**

## 差分で確かめたこと（0節との突き合わせ）

- #1: 複製の段で `index`・`privacy`・`terms`・`tokushoho`・`tech` の HTML と `style.css` だけ `copyStripped`（読む → 除く → 書く）。`robots.txt`・`sitemap.xml`・`assets/` は `cpSync` のまま
- #2・#3: 正規表現は定義どおり（`<!--[\s\S]*?-->`・`/\*[\s\S]*?\*/`、どちらも非貪欲）。空白の圧縮はしていない
- #4: 2 関数を export。`main()` は `isEntry`（`path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`）のときだけ。**R でも 3 通り確かめた**: 絶対パスで起動 → true、`apps/api` から相対パス（`predeploy` の形）で起動 → true、`import()` だけ → main は走らず export 2 つだけが見える
- #5〜#7: `package.json` の `build:public`・`apps/api` の `predeploy`・`deploy.yml` の呼び方は変わっていない。アプリ・API のコードは触っていない（差分のファイル一覧で確認）
- #8: 既存の `landing.test.ts` はソースを読むので変わらず（T4 は出力を見る）
- T3 の前提: `content:` の値は `""`・`"✓"`・`"+"`・`"−"` の 4 つだけ、`url(` にも `/*` 無し（テストが固定）
- `build.log`: exit 0、インライン script のハッシュの検査も従来どおり。`capture.json`: 配信される 6 つ全部で `<!--`・`/*` が 0、`consoleErrors` 0
- `.d.mts` を `.mjs` の隣に置く形は妥当（`declare module` の相対パスは ambient 宣言にならないので B の気づきどおり）

## 記録（判定に使わない）

1. `isEntry` はドライブ文字の大小（`c:\` と `C:\`）が違うと false になる（`path.resolve` は揃えない）。Windows の pnpm・PowerShell・Git Bash では `C:\` で揃っていて（今回の 3 通りで確認）、CI は Linux なので今は問題にならない。もし将来 `pnpm build:public` が「何もせず終わる」ことがあればここを疑う。任意
2. タスク定義の「約 980 個」は B の報告どおりソースの `/*` の数（30）とは合わない。判定には関係ない（A の記述の話）

## 私が確かめていないこと

- `pnpm build:public` の実走（Expo の export を含むので R では回していない。B の `build.log` と `capture.json` を読んだ）
- 本番デプロイ後の `https://nisoine.com/` の開発者ツール（人間の手番）
