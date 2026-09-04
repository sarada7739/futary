# 034: `pnpm audit` の通信失敗にリトライを入れる — テスト結果

## 前提: PR #227 による起票の訂正

起票時（`docs/tasks/034-audit-retry.md` 初版）は「外側に1秒→2秒→4秒のリトライを
足す」だったが、Bが出したジョブログ（`Will retry in 10 seconds. 2 retries
left.` → `Will retry in 1 minute. 1 retries left.`）から、**pnpmは既に内側で
2回・計3分待っていた**ことが分かった。外側に足す1秒→2秒→4秒は内側より短く、
何も足さない。Aが[PR #227](../../docs/tasks/034-audit-retry.md)でこれを訂正し、
「pnpmの待ちを延ばす」方針に変わった（未マージだが、内容はA自身の訂正であり
そのまま採用した）。

## 3節: 先に実測すること

### (1) 脆弱性で落ちたときの終了コードと出力

**通信は成功し、正常な200応答の中身が脆弱性ありだった場合、リトライは一切
発生しない。**

到達不能な実レジストリではこの状況を安全に再現できない（脆弱性の有無は
実際の依存関係とレジストリの現在の勧告に依存し、意図的に再現できない）ため、
`npm`の`POST /-/npm/v1/security/advisories/bulk`と同じ形式で固定の脆弱性を
返すモックHTTPサーバーを`127.0.0.1:34567`に立てて検証した（簡易実装。`left-pad`
パッケージに対しhighの脆弱性を1件返す。スクリプト本体は本節末尾）。

```
開始: 15:18:45.875
終了コード: 1
終了: 15:18:46.377
```

モックサーバー側のログ:
```
[mock] 2026-09-04T06:18:46.274Z POST /-/npm/v1/security/advisories/bulk (1回目)
[mock] 2026-09-04T06:18:46.284Z GET /left-pad (2回目)
```

**`--fetch-retries=5`を渡していても、advisories/bulkへのリクエストは1回だけ。
0.5秒で終了コード1。`Will retry`は一度も出力されない。**

さらに、`docs/tasks/034-audit-retry.md`実装後の`scripts/pnpm-audit.mjs`
ラッパー経由でも同じ結果になることを確認した（下記「ラッパーの結合テスト」）。

使い捨ての検証用スクリプト（`scripts/pnpm-audit.mjs`には含まれない）:

```js
import { createServer } from "node:http";

let requestCount = 0;

const server = createServer((req, res) => {
  requestCount++;
  console.log(`[mock] ${new Date().toISOString()} ${req.method} ${req.url} (${requestCount}回目)`);
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url?.includes("/security/advisories/bulk")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          "left-pad": [
            {
              id: 1,
              url: "https://example.invalid/mock-advisory",
              title: "モック脆弱性（034テスト用）",
              severity: "high",
              vulnerable_versions: "<=1.3.0",
              module_name: "left-pad",
              cwe: [],
              cvss: { score: 0, vectorString: null },
              findings: [{ version: "1.3.0", paths: ["left-pad"] }],
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
});

server.listen(34567, "127.0.0.1");
```

これは実装の裏付けにもなっている: pnpmのソース
（`createAuditNetworkOptions()`。`pnpm.mjs`内、`make-fetch-happen`への
`retries`オプションとして`opts3.fetchRetries`を渡している）を読むと、
`retries`は**HTTPリクエストそのものの失敗**（接続失敗・タイムアウト・5xx等）
にのみ効き、**200で返ってきた応答の中身**（脆弱性ありのJSON）には一切
関与しない。今回の実測はこれと一致した。

### (2) 通信で落ちたとき（既知。2026-09-04 当日のログより）

```
[WARN] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk error (23). Will retry in 10 seconds. 2 retries left.
[WARN] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk error (23). Will retry in 1 minute. 1 retries left.
[23] The operation was aborted due to timeout
```

**終了コードは非ゼロ（プロセスがタイムアウトで中断）。出力に`Will retry`が
複数回現れ、最終的に`error (23)`（`TimeoutError`相当）で終わる。**

脆弱性で落ちたときとの違い:
| | 脆弱性で赤 | 通信失敗で赤 |
|---|---|---|
| レジストリへのリクエスト回数 | 1回 | 設定したリトライ回数ぶん |
| `Will retry`の出力 | 無し | 有り |
| 所要時間 | 1秒未満 | リトライ待ち時間の合計 |

**区別できた。** 区別の根拠は出力（`Will retry`の有無とリクエスト回数）であり、
終了コード単体では両者とも非ゼロになりうるため区別できない。今回の実装は
この区別ロジックを自作していない（後述）ため、区別を誤って脆弱性を通す経路は
存在しない。

## `.npmrc`の`fetch-retries`は効かなかった（実測。CLIフラグは効いた）

最初に`.npmrc`（プロジェクトルート）に`fetch-retries=5`を書いて試したが、
**到達不能なレジストリ（`http://127.0.0.1:9/`。接続そのものが失敗するため
安全に繰り返し試験できる）に対して繰り返し実行しても、常に既定値の2回の
ままだった。**

```
$ cat .npmrc
registry=http://127.0.0.1:9/
fetch-retries=5

$ pnpm audit --audit-level=high
[WARN] ...error (unknown). Will retry in 10 seconds. 2 retries left.
[WARN] ...error (unknown). Will retry in 1 minute. 1 retries left.
```

`pnpm add left-pad`（audit以外のコマンド）でも同じ`.npmrc`で試したが、
やはり2回のままだった。**audit固有の問題ではない。**

環境変数`npm_config_fetch_retries=5`でも同様に効果が無かった。

`pnpm config get fetch-retries`は常に`undefined`を返す。`pnpm config
list`は`registry`・`registries`・`userAgent`しか表示しない（`config`
コマンド自体が扱うキーがごく一部に限られているため、これは`fetch-retries`が
実際に効いているかどうかの確認には使えないことも分かった）。

一方、**CLIフラグ`--fetch-retries=5`は確実に効いた:**

```
$ pnpm --fetch-retries=5 audit --audit-level=high --registry=http://127.0.0.1:9/
[WARN] ...error (unknown). Will retry in 10 seconds. 5 retries left.
[WARN] ...error (unknown). Will retry in 1 minute. 4 retries left.
```

**`.npmrc`の`registry`キーは同じファイルで正しく効いている**（実際に
`http://127.0.0.1:9/`へリクエストが飛んでいる）ため、`.npmrc`自体が読まれて
いないわけではない。`fetch-retries`というキーだけが反映されない。

`pnpm.mjs`のソースを読むと、`audit`コマンドの`rcOptionsTypes21()`は
`update_exports.rcOptionsTypes()`を経由して`fetch-retries`を含んでおり
（`types2`という設定キー→型のマップにも`fetch-retries: Number`として
存在する）、コード上は`.npmrc`からも読めるはずに見える。**しかし実測では
読めなかった。** この食い違いの根本原因（pnpm 11.24.0固有の不具合か、
このマシン固有の要因かは特定できていない）は未解明のまま残っているが、
**「動くはずのコードを読んだから正しい」ではなく「実測してどちらが動くかを
確かめる」を優先し、確実に効くCLIフラグの形を採用した。**

## 実装

`scripts/pnpm-audit.mjs`を新設し、`pnpm audit`を叩く3箇所すべて
（`ci.yml`・`deploy.yml`の出力専用/ゲートの2箇所、
`check-audit-ignore-staleness.mjs`内部の呼び出し）がこれを経由するようにした
（4節「リトライを1箇所に置く」）。

- リトライ回数の設定値（`--fetch-retries=5`）は`scripts/pnpm-audit.mjs`の
  1箇所にのみ存在する
- ラッパー自身は「リトライすべきか」を一切判断していない。`spawnSync`で
  `pnpm audit`をそのまま呼び、終了コードと出力（`stdio: "inherit"`）を
  そのまま返すだけ。区別ロジック（脆弱性か通信失敗か）はpnpm本体に
  委ねている（自作した区別ロジックが無いため、区別を誤る経路も無い）
- `.npmrc`は削除した（効果が無いことが実測で判明したため。残すと
  「これで効いている」という誤った説明になる）

## ラッパーの結合テスト

### 通信失敗が伸びることの確認（尽くしても駄目なら赤）

到達不能な`http://127.0.0.1:9/`に対し、ラッパー経由で実行:

```
開始: 15:18:53.840
15:18:54.290 Will retry in 10 seconds. 5 retries left.
15:19:04.302 Will retry in 1 minute. 4 retries left.
15:20:04.305 Will retry in 1 minute. 3 retries left.
15:21:04.309 Will retry in 1 minute. 2 retries left.
15:22:04.317 Will retry in 1 minute. 1 retries left.
15:23:04.383 [ERROR] fetch failed
終了: 15:23:04.800
```

**待ちが実際に伸びている。** 既定（2回。10秒→1分。計約3分10秒）に対し、
このラッパー（5回。10秒→1分×4。計約4分10秒）で約1分伸びている。ログの
`N retries left`の初期値が2から5に変わったことで確認できる。

別実行で終了コードも確認: **全リトライ失敗後は終了コード1。** `continue-on-error`
等は使っていないため、ここでジョブは赤のまま止まる（逃げ道を作っていない）。

### 脆弱性検出時にリトライしないことの確認（ラッパー経由）

同じモックレジストリ（`http://127.0.0.1:34567/`）に対しラッパー経由で実行:

```
開始: 15:18:45.875
終了コード: 1
終了: 15:18:46.377
```

モックサーバーへのリクエストは1回のみ。**ラッパーを経由しても、脆弱性検出時は
リトライされない。**

### 実レジストリでの動作確認

`check-audit-ignore-staleness.mjs`（ラッパー経由に書き換え後）を実際に
実行し、正常終了することを確認した:

```
$ node scripts/check-audit-ignore-staleness.mjs
無視リストの2件は、いずれも現在のaudit結果に存在します（陳腐化なし）。
終了コード: 0
```

ゲート（`node scripts/pnpm-audit.mjs --audit-level=high`）も実レジストリで
実行し、既知の2件（無視リスト登録済み）以外に新規のhigh以上が無いことを
確認した（終了コード0）。

## テスト・型チェック・lint

`pnpm -w eslint scripts/pnpm-audit.mjs scripts/check-audit-ignore-staleness.mjs`:
0 errors。（`.github/workflows/*.yml`はeslintの対象外。設定変更なし）

## 完了条件チェック

- [x] 3節の実測を先に済ませ、結果を`artifacts/034/`に記録した
- [x] pnpmの待ちが延び、ログでそれが確かめられている
- [x] 尽くして失敗したら赤になる（逃げ道を作っていない。`continue-on-error`
      等は使用していない）
- [x] 脆弱性で落ちたときはリトライしない（モックレジストリで実測）
- [x] `ci.yml`と`deploy.yml`の両方
- [x] リトライが1箇所（`scripts/pnpm-audit.mjs`）にまとまっている
- [x] `artifacts/034/`に証跡を保存
