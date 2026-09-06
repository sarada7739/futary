# 038: T9の検査を、ライブラリから引く形にする

## やったこと

### 1. 列挙をライブラリから引く

`apps/app/test/viewer-key-coverage.test.ts`に`import * as ReactQueryModule
from "@tanstack/react-query"`を追加し、テスト実行時に実際のモジュールを
読んで列挙する形にした（手で書かない）。

```ts
const RAW_REACT_QUERY_EXPORTS = Object.keys(ReactQueryModule).sort();
const RAW_QUERY_CLIENT_METHODS = Object.getOwnPropertyNames(ReactQueryModule.QueryClient.prototype)
  .filter((name) => name !== "constructor")
  .sort();
```

`@tanstack/react-query@5.102.3`（実際にインストールされているバージョン。
`node -e "console.log(require('@tanstack/react-query/package.json').version)"`
で確認済み）の公開面は以下のとおりだった:

- パッケージのexport: 59件
- `QueryClient`のインスタンスメソッド: 34件

この2つの一覧を、それぞれ手で書いた分類マップ
（`REACT_QUERY_EXPORT_CLASSIFICATION`・`QUERY_CLIENT_METHOD_CLASSIFICATION`）
の`Object.keys(...).sort()`と`toEqual`で突き合わせるテストを追加した。
ライブラリを上げて公開面が増減すると、このテストが赤くなる（分類マップに
無い新顔が現れる、または分類マップに載っているのに実物から消えている、
のどちらの方向でも気づける）。

### 2. 「キーを取るもの／取らないもの」の仕分け（理由つき）

各項目について、`node_modules`内の実際の実装
（`@tanstack/query-core/build/modern/queryClient.js`）を読んで、戻り値が
キャッシュ済みデータそのものを返すかどうかで判断した。

- **exact**（1件の値を読む・書くため、viewerKeyを厳密に要求する）: 19件
  - フック8件: `useQuery` `useInfiniteQuery` `useSuspenseQuery`
    `useSuspenseInfiniteQuery` `useQueries` `useSuspenseQueries`
    `usePrefetchQuery` `usePrefetchInfiniteQuery`
  - `QueryClient`メソッド11件: `setQueryData` `getQueryData` `getQueryState`
    `ensureQueryData` `ensureInfiniteQueryData` `fetchQuery`
    `fetchInfiniteQuery` `prefetchQuery` `prefetchInfiniteQuery` `query`
    `infiniteQuery`
    - **実装を読んで初めて分かったこと**: `query`/`infiniteQuery`は
      `fetchQuery`/`fetchInfiniteQuery`の後継（新API。既存は非推奨コメント
      付き）で、どちらも実際にキャッシュ済みデータをそのまま返す
      （`return queryData` / `return select(queryData)`）。Rが挙げた
      12通りにもタスク定義の一覧にも名前が無かったが、ライブラリの実物を
      読んだことで見つかった。手で写す限り絶対に気づけなかった項目
- **prefix**（既定で前方一致のフィルタとして効くため、viewerKeyを要求
  しない）: 7件 — `invalidateQueries` `cancelQueries` `removeQueries`
  `refetchQueries` `resetQueries` `setQueriesData` `getQueriesData`
- **excluded**（データそのものを読み書きしない。件数・設定・
  ライフサイクル等）: 残り全部（パッケージexport51件 + QueryClient
  メソッド16件）。理由は項目ごとに1行ずつ`viewer-key-coverage.test.ts`に
  書いた（例: `isFetching`/`isMutating`は件数を返すだけ、
  `setQueryDefaults`/`getQueryDefaults`はデータではなく既定オプションを
  読み書きするだけ、`useMutation`系はmutationKeyが対象でこの規約の対象外、
  等）

### 3. 別名importとブラケット記法を塞ぐ（入口の形を1つに決める）

037で`lib/orpc`に対してやったのと同じ形を、`@tanstack/react-query`にも
適用した。

- `@tanstack/react-query`からのimportは、別名なしの名前付きimportに限る
  （`import { useQuery as uq }`・`import * as RQ`はどちらも違反として
  検知する）
- `queryClient`のメソッド呼び出しはドット記法に限る
  （`queryClient["setQueryData"](...)`はメソッド名の有無に関わらず
  「ブラケット記法」として検知する）

**決めた形は`conventions.md`に書く必要がある（Aの担当。B判断で編集不可）。**
A/Rへの報告に明記した。

### 4. 両側から当てる

- Rが実測した12通り（`useSuspenseQuery` `useSuspenseInfiniteQuery`
  `useQueries` `useSuspenseQueries` `usePrefetchQuery` `ensureQueryData`
  `fetchQuery` `getQueryState` `prefetchQuery` `setQueryDefaults`
  ブラケット記法 別名import）を、それぞれ合成コードで実際に当て、
  想定どおりの結果になることを確認した:
  - データを返す10通り（`setQueryDefaults`を除く9通り＋実装調査で
    追加した`query`/`infiniteQuery`）は、viewerKeyが無いと赤・あると
    緑になることを確認
  - `setQueryDefaults`（`getQueryDefaults`も含めて）は、理由つきで
    「対象外」に分類されていること（分類マップに載っており、
    `ALL_CACHE_KEY_METHODS`には含まれないこと）を確認
  - ブラケット記法・別名importは、それぞれ別の検査（入口の形）で
    赤くなることを確認
- 037までに閉じたもの（使用箇所6通り・短縮記法4通り・`lib/`・
  `apps/app/app/test/`・免除の名指し・再エクスポート3通り）が引き続き
  効くことを、既存のテストの再実行で確認した

## テスト

`pnpm -r test`: apps/api 457件・apps/app 283件（旧256件+27件）、全て緑。
`pnpm -r type-check`・`pnpm -w eslint .`、全て通過。

## 完了条件との対応
- [x] 列挙がライブラリから引かれ、`toEqual`で固定されている
- [x] 別名importとブラケット記法が赤
- [ ] 決めた形が`conventions.md`に書かれている（**Aの担当**。この
      artifactsとA/Rへの報告で内容は明記済み）
- [x] Rが素通りさせた12通りが全部赤（`setQueryDefaults`は理由つきで
      対象外と分類。ブラケット記法・別名importは別の検査で赤）
- [x] これまでに閉じたものが引き続き効く
- [x] `artifacts/038/`に証跡を保存（本ファイル）
