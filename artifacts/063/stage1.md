# 063 段階1: 使われなくなったコードと、apps/api/src・packages/db/src・scripts のコメント

`docs/tasks/063-prune-comments-and-tests.md`。コミットは 2 つ: (1) デッドコード（0節 #10・#11）、(2) コメント。

## 1. 使われなくなったコード

`artifacts/063/removed-code.md`。061 の SVG フィルタ一式と `filterId`・`lens*` 3 つ、`unlockedPhotoIds()`、`type Db`、`tab-album.png`。
それに伴い消えたテスト 2 本は `artifacts/063/removed-tests.md`。

## 2. コメント（0節 #1〜#3 の基準）

消したもの: 経緯（「以前は」「訂正」「実測で判明」）、誰が言ったか（「R の指摘」「security-auditor 指摘」「A の決定」「人間の指摘」）、何回目か（「027・029 に続き 3 回目」）、コードの言い換え、`タスク定義 N 節` のような出どころの分からない参照。
残したもの: 理由（なぜこの順か・値か・素直に書かないか）、制約（D1 にトランザクションが無い・束縛パラメータ 100・Safari・Workers の癖）、セキュリティの意図（couple_id の強制・画像キーをログに出さない・fail-closed）、文書の節への参照（`architecture.md 4節` 等）。タスク番号は 1 つのコメントに 1 つまで。

### 前後の数

測り方（コメント行 = 行頭の空白の後が `//`・`/*`・`*`）:

```
git grep -hE '^[[:space:]]*(//|/[*]|[*])' <ref> -- <dir> | wc -l
```

| 範囲 | コメント行 前（main） | 後 | ファイル全体の行 前 → 後 |
|---|---|---|---|
| `apps/api/src` | 1,393 | **751** | 6,371 → 5,724 |
| `packages/db/src` | 226 | **113** | 658 → 544 |
| `scripts` | 268 | **84** | 648 → 464 |
| 計 | 1,887 | **948**（−939。約 50%） | 7,677 → 6,732 |

## 3. テストで証明すること

### T1: テストの本数と結果

`pnpm -r test`（全部緑）:

| パッケージ | 前（main 460742e） | 後 |
|---|---|---|
| packages/ui | 24 | 23（−1: T5「filterId は外観ごとに別」。#10） |
| packages/date | 67 | 67 |
| packages/db | 32 | 32 |
| apps/app | 632 | 631（−1: G6。#10） |
| apps/api | 786 | 786 |
| 計 | 1,541 | 1,539 |

減った 2 本はどちらも 0節 #10 で消したコード（`filterId`・`glassFilter()`）を検査していたもの。コメントの差分では 1 本も変わっていない。

型検査（`pnpm -r run type-check`）・eslint 緑。`pnpm build:public` exit 0（inline script 2 本の検査もそのまま通る。出力に `nisoine-glass` が 0 件）。

### T2: 差分がコメントと 0節 #10・#11 だけ

`node artifacts/063/scripts/compare-code.mjs <ref> <パス…>`: TypeScript のプリンタ（`removeComments: true`）で前後を出力し直して比べる（空行・改行位置・コメントの差は消える）。

- コミット (2)（コメント）: `apps/api/src`・`packages/db/src`・`scripts` の **57 ファイル全部「コメント以外が同じ」、コードが違うファイル 0**
- コミット (1)（デッドコード）: コードが違うのは `plan.ts`・`+html.tsx`・`glass-tab-bar.test.tsx`・`packages/db/src/index.ts`・`theme.ts`・`theme.test.ts` の 6 つだけで、中身は `removed-code.md`・`removed-tests.md` の表のとおり（`glass-tab-bar.tsx` はコメントだけの変更で「同じ」側に入る）

## 気づき（判断は A・人間）

- 0節 #11「export されているがどこからも import されない」: ファイルの中では使われているもの（約 110 件）は消していない（`export` を外すだけの変更で、コードの差分を増やすため）。要るなら A が決める
- `apps/api/src/procedures/me.ts` の退会の削除の並び（14 行の DELETE）には 1 行ずつの「027 追加」「3 回目」の注記があった。並びの理由（参照する側を先に）と「表を足したらここにも足す」の 2 行にまとめた。削除順そのものはテスト（0節 #6「退会の削除順」）が守っている
