# 038: T9 の検査を、ライブラリから引く形にする

## 目的

**`viewer-key-coverage` の走査を仕上げる。**

**037 から切り出した**（R の提案）。**T9 の穴は 037 が作ったものではない。**
**037 の中身（AI まとめ）は既に閉じている。機能を検査に人質に取らない。**

## 0. いまどこまで来ているか

**037 で6回作り直した。**

```
近傍N文字 → AST の2段 → 識別子起点 → import の形 → useQuery 側へ移す
```

**5回目までは、留め金が「`orpc` へどう辿り着いたか」＝開いた集合にあった。**
**6回目で、キャッシュ枠を作る側＝閉じた集合へ移した。そこは正しい**（R の判定）。

**残っているのは、その集合を手で写したことである。**

## 1. 列挙をライブラリから引く

**いまは手で書いた9件。**R が `@tanstack/react-query@5.102.3` の公開面を読んだところ、
**13通り当てて12通りが素通りした。**

| 素通りしたもの（一部） |
|---|
| `useSuspenseQuery` / `useSuspenseInfiniteQuery` / `useQueries` / `useSuspenseQueries` |
| `usePrefetchQuery` / `usePrefetchInfiniteQuery` |
| `ensureQueryData` / `ensureInfiniteQueryData` / `fetchQuery` / `fetchInfiniteQuery` |
| `prefetchQuery` / `prefetchInfiniteQuery` / `getQueryState` / `setQueryDefaults` / `getQueryDefaults` |

**`useSuspenseQuery` は `useQuery` の差し替え先である。**単一のキーでデータを返す。
**`ensureQueryData` も `fetchQuery` も `getQueryState` も、データを返す。どれも T9 そのものである。**

### やること

- **`@tanstack/react-query` の export と `QueryClient` のメソッドを、テスト実行時に読む**
- **引いた一覧を `toEqual` で固定する。**バージョンを上げたら差分に出る
- **一覧のうち「キーを取るもの」と「取らないもの」を、理由つきで分ける**

**「増えるとしたらライブラリを上げたときで、そのときは差分に出る」と書いた。
いまは差分に出ない。手で写した9件は、上げても動かない。**

## 2. 名前の書き換えを塞ぐ（別の軸）

**別名 import とブラケット記法で抜ける**（R が実測）。

```ts
import { useQuery as uq } from "@tanstack/react-query";   // 素通り
queryClient["setQueryData"](...)                            // 素通り
```

**`profile.tsx` で穴を開けた状態で、テスト28件・app 256件・lint・type-check、全部通った。**

### やること

**入口の形を1つに決める**（037 で `lib/orpc` に対してやったのと同じ）。

- **`@tanstack/react-query` からの import は、別名なしの名前付き import に限る**
- **`queryClient` のメソッドはドット記法に限る。**ブラケット記法は赤

**決めたら `conventions.md` に書く。**検査だけあって規約に無いと、**踏んだ人が「なぜ赤いのか」を探す。**

## 3. 両側から当てる

**#246 のとおり。**

- **R が素通りさせた13通りが、全部赤になること**
- **いま正しく書かれている呼び出しが、全部緑のままであること**

**「構造上通るはず」で済ませない**（`d3b2f98` で B が自己申告したとおり。
**構造上通るはず、は、通ることの証明ではない**）。

## テストで証明すること
- **ライブラリから引いた一覧が `toEqual` で固定されている**
- **R が挙げた12通りが、全部赤**
- **別名 import・ブラケット記法が赤**
- **037 までに閉じたもの**（使用箇所6通り・短縮記法4通り・`lib/`・
  `apps/app/app/test/`・免除の名指し・再エクスポート3通り）**が引き続き効く**

## 完了条件
- [x] 列挙がライブラリから引かれ、`toEqual` で固定されている
- [x] 別名 import とブラケット記法が赤
- [ ] 決めた形が `conventions.md` に書かれている（**書くのは A**。決めた内容は
      `artifacts/038/summary.md`とA/Rへの報告に明記済み）
- [x] R が素通りさせた12通りが全部赤（`setQueryDefaults`/`getQueryDefaults`は
      理由つきで対象外に分類。ブラケット記法・別名importは別の入口検査で赤）
- [x] これまでに閉じたものが引き続き効く
- [x] `artifacts/038/` に証跡を保存

## 停止条件
- 完了: 上記をすべて満たす
- **中断: ライブラリの公開面を読む方法が見つからなかったら、A に上げる**
  （**手で写す形に戻さない**）
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へ

## 進捗
- [x] ライブラリからの列挙（`import * as ReactQueryModule from "@tanstack/react-query"`を
      テスト実行時に読む形。59件のexport・34件の`QueryClient`メソッドを実測）
- [x] 「キーを取るもの／取らないもの」の仕分け（理由つき。exact19件・
      prefix7件・excluded67件。`node_modules`内の実装を読んで判断した）
- [x] 別名 import・ブラケット記法（`@tanstack/react-query`のimportを
      名前付き・別名無しに限定。`queryClient`のメソッド呼び出しをドット
      記法に限定）
- [x] 12通りを当てる（Rの実測どおり。うち`setQueryDefaults`は対象外分類、
      ブラケット記法・別名importは別検査）
- [x] 証跡保存 → `state.md` 更新 → `worklog.md` 追記
