# 069: 依存の既知脆弱性に追随する（shell-quote・source-map-js・compression・sharp）

`docs/tasks/069-deps-security-shell-quote.md` の 0節 #1・1節。

## `pnpm audit` の前後

| | critical | high | moderate |
|---|---|---|---|
| 前（main 7931a65） | 1 | 7（うち 4 は無視リスト） | 3 |
| 後 | 0 | 4（4 とも無視リスト） | 3 |

後の high 4 件は無視リストの image-size 2・node-forge・braces だけ。moderate 3（esbuild・uuid・decode-uri-component）は 0節 #2 のとおり触っていない。

## 上げ方（0節 #1 の順）

1. **lockfile の更新**: `pnpm update -r --depth=Infinity shell-quote source-map-js compression sharp` を流した。**lockfile は変わらなかった**（4 つとも前の版のまま。既存の js-yaml の override のコメントと同じく、推移的依存は動かなかった）
2. **親を上げる**: 4 つの親が宣言している範囲を調べた

   | パッケージ | 親（今の版）の宣言 | 親の最新版 |
   |---|---|---|
   | shell-quote | `react-devtools-core` 6.1.5: `^1.6.1` | 8.0.0 も `^1.6.1` |
   | source-map-js | `postcss` 8.5.26・`css-tree` 3.2.1: `^1.2.1` | （範囲が修正版を含む） |
   | compression | `@expo/cli` 57.0.18: `^1.7.4` | （範囲が修正版を含む） |
   | sharp | `miniflare`: `0.35.4`（固定） | 5.20261006.0-alpha（wrangler 4.148.0 の中）も `0.35.4` |

   shell-quote・source-map-js・compression は、親の範囲がもう修正版を含むので、親を上げても lockfile の版は変わらない。sharp は、miniflare の最新版も 0.35.4 に固定しているので、親を上げても直らない
3. **override**: `pnpm-workspace.yaml` の `overrides` に 4 つを足した（既存の js-yaml と同じ書き方。`"<パッケージ>@<修正版未満>": "<修正版>"`）。それぞれに勧告・経路・到達可能性（どれも開発・ビルド・テスト時だけで、Worker と配信アセットには含まれない）・消す条件のコメントを付けた

   | override | 消す条件 |
   |---|---|
   | `"shell-quote@<1.11.0": "1.11.0"` | lockfile が shell-quote>=1.11.0 を解決するようになったら |
   | `"source-map-js@<1.2.2": "1.2.2"` | lockfile が source-map-js>=1.2.2 を解決するようになったら |
   | `"compression@<1.8.2": "1.8.2"` | lockfile が compression>=1.8.2 を解決するようになったら |
   | `"sharp@<0.35.5": "0.35.5"` | miniflare が sharp>=0.35.5 を宣言したら |

lockfile の変化は、この 4 つと sharp の付属パッケージ（`@img/sharp-*` 0.35.4 → 0.35.5・`@img/sharp-libvips-*` 1.3.3 → 1.3.4）だけ。

## テスト

- T1: `node scripts/pnpm-audit.mjs --audit-level=high` は終了コード 0（high は無視リストの 4 件だけ）。`node scripts/check-audit-ignore-staleness.mjs`: 「無視リストの4件は、いずれも現在のaudit結果に存在します（陳腐化なし）」
- T2: `grep -cE "shell-quote@1\.10\.0|source-map-js@1\.2\.1|compression@1\.8\.1|sharp@0\.35\.[0-4]\b" pnpm-lock.yaml` → **0**
- T3: `pnpm -r test`: ui 23・date 68・db 34・app 630・api 808 = 1,563 緑（前と同じ）。type-check・lint 緑。`pnpm build:public` → `wrangler dev`（sharp 0.35.5 の入った miniflare）で `/` と `/app/` が 200。サーバのログにエラーなし

## Dependabot の警告

マージして main の lockfile が変われば、自動で閉じる見込み。閉じたかどうかはマージのあとで見る（0節 #3）。
