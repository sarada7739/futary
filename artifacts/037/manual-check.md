# 037: AIまとめ — 人間の実機・実運用確認項目

Bが自動で確認できない項目をここに列挙する。

- **実際にOpenAI/AnthropicのAPIキーを`wrangler secret`で設定し、本番で1回だけ
  実際に生成できることを確認する**（Bは費用が発生するため実際のAPI呼び出しを
  行っていない。`apps/api/src/lib/ai.ts`のプロバイダ別リクエスト形式
  〈`buildProviderRequest`〉は実際のAPIドキュメントを見て組み立てたが、
  実際に叩いて応答形式が一致するかは確認できていない）
- **マイページの同意チェック・AIまとめ画面の「作り直す」ボタン等が、実機
  （iPhone/Android/デスクトップブラウザ）で崩れていないか**（Playwrightで
  390×844のスクリーンショットは確認したが、実機は未確認）
- **`AI_PROVIDER`を`anthropic`に切り替えたとき、実際にAnthropicのAPIを
  叩けるか**（プロバイダの切り替え自体は`resolveAiConfig`・
  `buildProviderRequest`のテストで確認しているが、実際のAPIキーでの疎通は
  未確認）

## シードの「まとめ」について

`packages/db/seed/demo.ts`にデモ用のまとめを2件（月次1件・週次1件）追加した。
**これらは実際にLLMで生成した文章ではなく、Bが人手で書いた説明文である。**
`provider: 'openai'`と記録されているが、実際にOpenAIのAPIを呼んだ結果では
ない。
