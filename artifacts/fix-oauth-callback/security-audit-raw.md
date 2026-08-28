# fix/oauth-callback-and-double-submit security-auditor 生ログ

### [2026-08-29] 監査対象: `apps/app/app/(auth)/sign-in.tsx`（callbackURL の絶対URL化 / signIn.social 再入防止）

#### 結論

**Critical / High の指摘はなし。** 2件の修正はいずれも認証フロー上妥当であり、オープンリダイレクトは成立しません。指摘は Low 4件（設定の将来リスクとガードの堅牢性）です。

#### 検証した内容（根拠）

**1. `window.location.origin` を `callbackURL` に渡すことは、オープンリダイレクトにならない**

Better Auth 1.7.2 側にサーバ側の許可オリジン検証が存在することを実コードで確認しました。

- `better-auth/dist/api/index.mjs:157-160` — `originCheckMiddleware` が `path: "/**"` に対して router 全体に適用される
- `better-auth/dist/api/middlewares/origin-check.mjs:44-69` — GET/OPTIONS/HEAD 以外で `body.callbackURL` を `ctx.context.isTrustedOrigin(url, ...)` にかけ、外れると `FORBIDDEN` / `INVALID_CALLBACK_URL` を投げる。`signIn.social` は POST なので必ずこの検証を通る
- `better-auth/dist/auth/trusted-origins.mjs:94-95` — http/https の URL は `pattern === getOrigin(url)` の**完全一致**。前方一致ではないので `https://futary.example.com.evil.test` のような細工は通らない
- `better-auth/dist/context/helpers.mjs:73-74` — `trustedOrigins` には常に `baseURL` のオリジンが含まれる

したがって本番（同一 Worker 配信で `window.location.origin === BETTER_AUTH_URL` のオリジン）は `TRUSTED_ORIGINS` が空でも通り、ローカルは `.dev.vars.example:23` の `http://localhost:8081` 等が明示されているから通る。**許可リストに無いオリジンは fail-closed で拒否される**ので、攻撃者が別オリジンでアプリを配信しても callbackURL は弾かれます。

**2. セッショントークンが URL クエリに載る経路は生じない**（`security-requirements.md` 2節に直結するため確認）

`@better-auth/expo/dist/index.js:77-81`:
```js
if (redirectURL.protocol === "http:" || redirectURL.protocol === "https:") return;
if (!ctx.context.isTrustedOrigin(location)) return;
const cookie = headers?.get("set-cookie");
if (!cookie) return;
redirectURL.searchParams.set("cookie", cookie);
```
`?cookie=` の付与は**カスタムスキーム（非 http/https）のリダイレクト先に限定**されています。`window.location.origin` は常に http/https なので、この変更でトークンが URL に露出することはありません。`apps/api/src/auth.ts:85` で `expo()` プラグインが有効なため、ここは実際に確認が必要な箇所でした。

**3. callbackURL で認可ガードを迂回できない**

`apps/app/app/_layout.tsx:31-39` の画面出し分けは `useSession()` と `couple.get` の結果のみで決まり、リダイレクト先 URL には依存しません。ログイン後に `/` へ戻っても、ペア未所属なら `(onboarding)` に倒れます。`couple_id` スコープ・デモ経路・招待コード・R2 のいずれも本変更では触れていません。

#### 指摘事項

| 重大度 | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| Low | `apps/api/src/auth.ts:53-59` | `TRUSTED_ORIGINS` は「CORS 許可リスト」に加えて「OAuth ログイン後リダイレクト先の許可リスト」を兼ねるようになった。`parseTrustedOrigins` はスキームしか検証しておらずワイルドカードを弾かない。`https://*.pages.dev` はWHATWG URLパーサで成功し、`*.pages.dev`/`*.workers.dev`のようなCloudflareの共有ドメインが誤って信頼されうる。現時点の設定値はlocalhostのみで悪用不能だが、将来CORSを緩めた1行が認証リダイレクト面を静かに広げる構造 | `parseTrustedOrigins`で`*`と`?`を含む値を拒否する |
| Low | `apps/app/app/(auth)/sign-in.tsx:27-29` | 再入ガードの解除タイミングがナビゲーション前。`signIn.social`のPromiseはredirect開始直後にresolveするため、`.finally`で即座に戻すと遷移完了までの間にもう一度クリックされる余地が残る | 成功時（リダイレクト開始時）はフラグを戻さずラッチする |
| Low | `apps/app/app/(auth)/sign-in.tsx:22, 53-56` | モジュールスコープの`let`はガード状態がUIに反映されない。Promiseが settle しなかった場合フラグが残り続け、アプリ再起動までログイン不能になりうる | `useState` + `Button`の`disabled`に置き換える |
| Low | `apps/app/app/(auth)/sign-in.tsx:27` | `void`で戻り値を捨てており失敗が完全に無言 | 汎用の失敗メッセージを表示する |

#### 補足（指摘ではない、記録として）

- expo authorization proxy遮断は本変更後も有効。ネイティブ経路は`callbackURL: "/"`のままで挙動は変わっていない
- `@better-auth/expo`は`NODE_ENV === "development"`のとき`trustedOrigins`に`exp://`を注入する。現状`NODE_ENV`はWorkerに設定されていないため無効。将来`NODE_ENV`をWorkerの変数に足さないこと
- ローカル開発ではCookieがポートを区別しないため、ログイン後に`http://localhost:8081`へ着地するとExpo開発サーバにもセッションCookieが送られる。ただしこれは変更前から全ページロードで発生しており、本変更が新たに作った経路ではない

#### 総評

認証フロー変更として妥当。信頼判断がクライアントからサーバの`TRUSTED_ORIGINS`に移った点が本質的な変化であり、Low1件目（ワイルドカード拒否）はその移動に見合った補強として、安価なうちに入れておくことを推奨。

## 対応

- Low1（ワイルドカード拒否）: `apps/api/src/auth.ts`の`assertAllowedUrl`にホスト名の`*`/`?`拒否チェックを追加。テストも追加（`apps/api/test/auth.test.ts`）
- Low2+3（ガードの堅牢性）: `apps/app/app/(auth)/sign-in.tsx`をuseState化し、`Button`の`disabled`と連動させた。成功時（`result.error`が無い場合）はフラグを戻さず、失敗時のみ戻す形に変更
- Low4（無言の失敗）: **未対応（記録のみ）**。専用のエラー表示UIコンポーネントが現状無く、今回のバグ修正のスコープを超えると判断。将来のUI実装タスクで対応する
