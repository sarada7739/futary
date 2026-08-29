# fix/reject-get-writes — 手動確認（curl実測）

実行日: 2026-08-29 / セッションB
対象: ローカル `wrangler dev`（http://localhost:8787）

## 【訂正】このファイルの当初の記述は誤りでした

Rレビューで、`@orpc/server` の `RPCHandler` は既定（`strictGetMethodPluginEnabled` を
渡さない場合）で `StrictGetMethodPlugin` を自動登録しており、**GET経由での手続き実行は
元々拒否されていた**ことが判明した（`@orpc/server/dist/adapters/fetch/index.mjs` の
`RPCHandler` コンストラクタで確認済み）。**CSRF の経路は存在しなかった。**

下記の「修正前の再現確認」で実際に貼った出力（`GET /api/couple/get (no data): 405`）は
当時から正しく、修正前から一貫して405だった。それにもかかわらず直後の散文で
「修正前は`200`になっていた」と誤って書いてしまっていた。**実測（405という結果）が
指摘（GETが通る）と矛盾していたのに、それを読まずに監査の指摘をそのまま記録した。**
実測が指摘と食い違ったときは実測を疑い、次に指摘を疑うべきだった。

コードと回帰テストはそのまま残す（ライブラリの既定に依存しない意味で妥当。将来
oRPCが既定を変えた場合や `strictGetMethodPluginEnabled: false` が渡された場合を
捕まえる）。以下は当時の記録をそのまま残し、誤りの経緯が追えるようにしている。

## 修正前の再現確認（009 M2まとめ監査時点、mainブランチのコード）

**【訂正】以下の実測結果自体は正しい。誤っていたのはその直後の解釈である。**

```
$ curl -s -X POST -H "Content-Type: application/json" -d '{}' -o /dev/null -w "POST /api/couple/get: %{http_code}\n" http://localhost:8787/api/couple/get
POST /api/couple/get: 403

$ curl -s -o /dev/null -w "GET /api/couple/get (no data): %{http_code}\n" http://localhost:8787/api/couple/get
GET /api/couple/get (no data): 405
```

~~修正前は最後の行が `200`（またはリクエストの中身次第で `403`/`409` 等、いずれにせよ
`405` 以外）になっていた。手続きが実際に実行されていたことを意味する。~~
→ **誤り。上の実測どおり、修正前から`405`だった。GETは元々拒否されていた。**

## 修正後の確認

```
$ curl -s -o /dev/null -w "POST /api/couple/update: %{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"json":{"anniversaryDate":"2020-01-01"}}' http://localhost:8787/api/couple/update
POST /api/couple/update: 403

$ curl -s -o /dev/null -w "GET /api/couple/update (no data): %{http_code}\n" http://localhost:8787/api/couple/update
GET /api/couple/update (no data): 405

$ curl -s -o /dev/null -w "GET /api/couple/update (with data): %{http_code}\n" "http://localhost:8787/api/couple/update?data=%7B%22json%22%3A%7B%22anniversaryDate%22%3A%222020-01-01%22%7D%7D"
GET /api/couple/update (with data): 405
```

`GET` は `data` クエリパラメータの有無に関わらず `405 Method Not Supported` になり、
`POST` は従来どおり（未認証のため `403 FORBIDDEN`）動作する。

## 既存の読み取り専用手続き（`health.get`）への影響確認

```
$ curl -s -o /dev/null -w "GET /api/health/get: %{http_code}\n" http://localhost:8787/api/health/get
GET /api/health/get: 405
```

`health.get` も `GET` では `405` になる。oRPC の手続きは明示的に GET を許可
（`.route({ method: "GET" })`）しない限り既定で POST 専用として扱われるため、
`StrictGetMethodPlugin` の一律拒否の対象になる。

**実害は無いと判断した。** クライアント側（`apps/app/lib/orpc.ts` の `RPCLink`）は
全リクエストを POST で送信しており、`health.get` を GET で直接叩く経路は
アプリのコードに存在しない。`apps/api/test/health.test.ts` は `RPCLink` 経由の
結合テストであり、この修正後も緑のままであることを確認済み（`test-results.txt`）。

## テスト・型チェック・lint

- `pnpm --filter @futary/api run test`: 131件すべて緑（009マージ後のmainベース。
  `method-restriction.test.ts` 3件を含む）。詳細は `test-results.txt`
- `pnpm --filter @futary/api run type-check`: 通過。詳細は `type-check-results.txt`
- `pnpm lint`: エラーなし。詳細は `lint-results.txt`
